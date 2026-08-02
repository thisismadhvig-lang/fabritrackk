from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import app


def test_fabric_purchase_dispatch_and_returns_flow():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Blue",
            "supplier": "Supplier A",
            "kg_received": 10,
            "cost_per_kg": 25,
            "date_received": "2026-02-01",
            "notes": "purchase for new season",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text
    lot = lot_resp.json()

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Test", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text
    vendor = vendor_resp.json()

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot["id"],
            "vendor_id": vendor["id"],
            "date": "2026-02-02",
            "kg_dispatched": 2,
            "notes": "dispatch for production",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch = dispatch_resp.json()

    return_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch["id"],
            "pieces_received": 1,
            "notes": "returned after qc",
        },
    )
    assert return_resp.status_code == 200, return_resp.text
    returned = return_resp.json()

    assert returned["dispatch_id"] == dispatch["id"]
    assert returned["order_id"] == dispatch["id"]
    assert returned["vendor_id"] == vendor["id"]

    returns_resp = client.get("/api/production-returns")
    assert returns_resp.status_code == 200
    returns = returns_resp.json()
    assert len(returns) == 1
    assert returns[0]["dispatch_no"] == dispatch["id"]
    assert returns[0]["pieces_left"] == 1


def test_return_dispatch_options_expose_dispatch_line_metadata():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Blue",
            "supplier": "Supplier B",
            "kg_received": 20,
            "cost_per_kg": 18,
            "date_received": "2026-02-03",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor B", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "date": "2026-02-04",
            "kg_dispatched": 6,
            "notes": '{"dispatchNo": "FD-1002", "expectedPieces": 4, "avgFabricPerPiece": 1.5, "lines": [{"fabricName": "Cotton", "brandName": "Brand X", "productType": "Shirt", "quantity": 6, "rolls": 2, "avgFabricPerPiece": 1.5, "unit": "kg"}] }',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    dispatches_resp = client.get("/api/production-returns/dispatches")
    assert dispatches_resp.status_code == 200
    dispatches = dispatches_resp.json()
    dispatch = next(item for item in dispatches if item["dispatch_no"] == "FD-1002")
    assert dispatch["fabric_name"] == "Cotton"
    assert dispatch["brand_name"] == "Brand X"
    assert dispatch["product_type_name"] == "Shirt"
    assert dispatch["quantity"] == 6
    assert dispatch["unit"] == "kg"
    assert dispatch["rolls"] == 2
    assert dispatch["avg_fabric_per_piece"] == 1.5
    assert dispatch["expected_pieces"] == 4.0
