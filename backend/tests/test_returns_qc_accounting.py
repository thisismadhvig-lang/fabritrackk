from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import app


def test_production_return_persists_manual_values_across_create_and_edit():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Manual Fields", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Blue",
            "supplier": "Supplier Manual Fields",
            "kg_received": 50.0,
            "cost_per_kg": 10.0,
            "date_received": "2026-01-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "order-manual-fields",
            "product_type_id": "product-type-manual-fields",
            "kg_dispatched": 10.0,
            "date": "2026-01-02",
            "notes": '{"dispatchNo": "FD-MAN-001", "expectedPieces": 10, "avgFabricPerPiece": 1}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch_id = dispatch_resp.json()["id"]

    create_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_id,
            "pieces_received": 2,
            "expected_pieces": 12,
            "avg_fabric_per_piece": 1.75,
            "fabric_still_lying_kg": 4.5,
            "job_work_rate": 10.0,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["expected_pieces"] == 12.0
    assert created["avg_fabric_per_piece"] == 1.75
    assert created["fabric_still_lying_kg"] == 4.5

    list_resp = client.get("/api/production-returns")
    assert list_resp.status_code == 200, list_resp.text
    listed = next(item for item in list_resp.json() if item["id"] == created["id"])
    assert listed["expected_pieces"] == 12.0
    assert listed["avg_fabric_per_piece"] == 1.75
    assert listed["fabric_still_lying_kg"] == 4.5

    update_resp = client.patch(
        f"/api/production-returns/{created['id']}",
        json={
            "expected_pieces": 13,
            "avg_fabric_per_piece": 1.9,
            "fabric_still_lying_kg": 5.25,
        },
    )
    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["expected_pieces"] == 13.0
    assert updated["avg_fabric_per_piece"] == 1.9
    assert updated["fabric_still_lying_kg"] == 5.25

    list_resp_after = client.get("/api/production-returns")
    assert list_resp_after.status_code == 200, list_resp_after.text
    listed_after = next(item for item in list_resp_after.json() if item["id"] == created["id"])
    assert listed_after["expected_pieces"] == 13.0
    assert listed_after["avg_fabric_per_piece"] == 1.9
    assert listed_after["fabric_still_lying_kg"] == 5.25


def test_production_return_uses_saved_expected_pieces_for_pieces_left():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Pieces Left", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Orange",
            "supplier": "Supplier Pieces Left",
            "kg_received": 100.0,
            "cost_per_kg": 5.0,
            "date_received": "2026-04-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "order-pieces-left",
            "product_type_id": "product-type-pieces-left",
            "kg_dispatched": 100.0,
            "date": "2026-04-02",
            "notes": "{}",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch_id = dispatch_resp.json()["id"]

    create_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_id,
            "pieces_received": 5000,
            "expected_pieces": 25000,
            "avg_fabric_per_piece": 4.0,
        },
    )
    assert create_resp.status_code == 200, create_resp.text

    list_resp = client.get("/api/production-returns")
    assert list_resp.status_code == 200, list_resp.text
    created_row = next(item for item in list_resp.json() if item["id"] == create_resp.json()["id"])
    assert created_row["expected_pieces"] == 25000.0
    assert created_row["pieces_left"] == 20000.0


def test_production_return_persists_manual_fabric_consumed_field():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Fabric Consumed", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Black",
            "supplier": "Supplier Fabric Consumed",
            "kg_received": 40.0,
            "cost_per_kg": 8.0,
            "date_received": "2026-02-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "order-fabric-consumed",
            "product_type_id": "product-type-fabric-consumed",
            "kg_dispatched": 8.0,
            "date": "2026-02-02",
            "notes": '{"dispatchNo": "FD-FC-001", "expectedPieces": 8, "avgFabricPerPiece": 1}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch_id = dispatch_resp.json()["id"]

    create_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_id,
            "pieces_received": 2,
            "fabric_consumed_kg": 3.5,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["pieces_received"] == 2
    assert created["fabric_consumed_kg"] == 3.5

    list_resp = client.get("/api/production-returns")
    assert list_resp.status_code == 200, list_resp.text
    listed = next(item for item in list_resp.json() if item["id"] == created["id"])
    assert listed["fabric_consumed_kg"] == 3.5


def test_production_return_does_not_fallback_to_dispatch_quantity_for_expected_pieces():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor No Fallback", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Green",
            "supplier": "Supplier No Fallback",
            "kg_received": 1000.0,
            "cost_per_kg": 12.0,
            "date_received": "2026-03-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "order-no-fallback",
            "product_type_id": "product-type-no-fallback",
            "kg_dispatched": 1000.0,
            "date": "2026-03-02",
            "notes": "{}",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch_id = dispatch_resp.json()["id"]

    create_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_id,
            "pieces_received": 2,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["expected_pieces"] == 0.0
    assert created["avg_fabric_per_piece"] == 0.0


def test_production_return_creates_and_updates_linked_payable():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Returns", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Blue",
            "supplier": "Supplier Returns",
            "kg_received": 50.0,
            "cost_per_kg": 10.0,
            "date_received": "2026-01-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "order-returns-test",
            "product_type_id": "product-type-returns",
            "kg_dispatched": 10.0,
            "date": "2026-01-02",
            "notes": '{"dispatchNo": "FD-RET-001", "expectedPieces": 10, "avgFabricPerPiece": 1}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch_id = dispatch_resp.json()["id"]

    create_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_id,
            "pieces_received": 2,
            "challan_no": "CH-1001",
            "job_work_rate": 15.0,
        },
    )
    assert create_resp.status_code == 200, create_resp.text
    created = create_resp.json()
    assert created["job_work_amount"] == 30.0
    assert created["job_work_rate"] == 15.0

    payables = client.get("/api/payables").json()
    linked_payable = next(
        (item for item in payables if str(item.get("notes", "")).find(f"production_return_id:{created['id']}") >= 0),
        None,
    )
    assert linked_payable is not None
    assert linked_payable["vendor"] == "Vendor Returns"
    assert linked_payable["reference_no"] == "CH-1001"
    assert linked_payable["original_job_work_amount"] == 30.0
    assert linked_payable["total_material_adjustment"] == 0.0
    assert linked_payable["net_payable_amount"] == 30.0
    assert linked_payable["outstanding_balance"] == 30.0

    update_resp = client.patch(
        f"/api/production-returns/{created['id']}",
        json={"pieces_received": 3, "job_work_rate": 20.0, "challan_no": "CH-1002"},
    )
    assert update_resp.status_code == 200, update_resp.text
    updated = update_resp.json()
    assert updated["job_work_amount"] == 60.0
    assert updated["job_work_rate"] == 20.0

    payables_after = client.get("/api/payables").json()
    linked_payable_after = next(
        (item for item in payables_after if item.get("id") == linked_payable["id"]),
        None,
    )
    assert linked_payable_after is not None
    assert linked_payable_after["reference_no"] == "CH-1002"
    assert linked_payable_after["original_job_work_amount"] == 60.0
    assert linked_payable_after["total_amount"] == 60.0
    assert linked_payable_after["net_payable_amount"] == 60.0
    assert linked_payable_after["outstanding_balance"] == 60.0
