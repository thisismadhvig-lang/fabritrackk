import pytest
from uuid import uuid4
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_party_master_and_ledger_generate_entries(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    party_resp = client.post(
        "/api/parties",
        json={
            "name": "Kumar Garments",
            "party_type": "Vendor",
            "contact_name": "Kumar",
            "phone": "9999999999",
            "tax_number": "GST123",
            "address": "Delhi",
            "email": "kumar@example.com",
            "remarks": "Vendor for job work",
            "opening_balance": 1000.0,
        },
    )
    assert party_resp.status_code == 200, party_resp.text
    party = party_resp.json()
    assert party["name"] == "Kumar Garments"

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Kumar Garments", "type": "third_party", "contact": "Kumar", "location": "Delhi"},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Blue",
            "supplier": "Kumar Garments",
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
            "order_id": "order-party-ledger",
            "product_type_id": "product-type-party-ledger",
            "kg_dispatched": 12.0,
            "date": "2026-01-02",
            "notes": '{"dispatchNo": "FD-PL-100"}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    ledger_resp = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert ledger_resp.status_code == 200, ledger_resp.text
    payload = ledger_resp.json()
    assert payload["party"]["id"] == party["id"]
    assert payload["summary"]["party_name"] == "Kumar Garments"
    assert any(entry["module_name"] == "Fabric Dispatch" for entry in payload["entries"])
    assert any(entry["module_name"] == "Opening Balance" for entry in payload["entries"])
    assert payload["entries"][0]["running_balance"] == 1000.0


def test_fabric_dispatch_creates_party_ledger_entry_with_amount_and_reference(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    party_resp = client.post(
        "/api/parties",
        json={
            "name": "Anand Textiles",
            "party_type": "Vendor",
            "opening_balance": 0.0,
            "remarks": "Fabric dispatch party",
        },
    )
    assert party_resp.status_code == 200, party_resp.text
    party = party_resp.json()

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Anand Textiles", "type": "third_party", "contact": "Anand", "location": "Surat"},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "White",
            "supplier": "Anand Textiles",
            "kg_received": 100.0,
            "cost_per_kg": 10.0,
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
            "order_id": "ORDER-FT-1",
            "product_type_id": "product-type-ft-1",
            "kg_dispatched": 10.0,
            "date": "2026-04-02",
            "notes": '{"dispatchNo": "FD-FT-100"}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    ledger_resp = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert ledger_resp.status_code == 200, ledger_resp.text
    ledger_payload = ledger_resp.json()
    entry = next(entry for entry in ledger_payload["entries"] if entry["module_name"] == "Fabric Dispatch")
    assert entry["reference_no"] == "FD-FT-100"
    assert entry["credit"] == 100.0


def test_material_dispatch_creates_and_deletes_party_ledger_entry(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Metro Supply", "type": "third_party", "contact": "Metro", "location": "Mumbai"},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text
    vendor = vendor_resp.json()

    inventory_resp = client.post(
        "/api/material-inventory",
        json={
            "date": "2026-03-01",
            "material_name": "Thread",
            "supplier": "Metro Supply",
            "quantity": 20,
            "unit": "kg",
            "rate": 5,
            "notes": "Stock for dispatch",
        },
    )
    assert inventory_resp.status_code == 200, inventory_resp.text

    party_resp = client.post(
        "/api/parties",
        json={
            "name": "Metro Supply",
            "party_type": "Vendor",
            "opening_balance": 0.0,
            "remarks": "Material dispatch party",
        },
    )
    assert party_resp.status_code == 200, party_resp.text
    party = party_resp.json()

    dispatch_resp = client.post(
        "/api/material-dispatches",
        json={
            "date": "2026-03-02",
            "dispatch_no": f"MD-TEST-{uuid4().hex[:8]}",
            "vendor_id": vendor["id"],
            "material_name": "Thread",
            "quantity": 5,
            "unit": "kg",
            "rate": 6,
            "purpose": "Job work",
            "notes": "Demo dispatch",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    ledger_resp = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert ledger_resp.status_code == 200, ledger_resp.text
    ledger_payload = ledger_resp.json()
    assert any(entry["module_name"] == "Material Dispatch" for entry in ledger_payload["entries"])

    delete_resp = client.delete(f"/api/material-dispatches/{dispatch_resp.json()['id']}")
    assert delete_resp.status_code == 200, delete_resp.text

    ledger_after_delete = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert ledger_after_delete.status_code == 200, ledger_after_delete.text
    assert not any(entry["module_name"] == "Material Dispatch" for entry in ledger_after_delete.json()["entries"])


def test_material_purchase_and_transaction_edit_update_party_ledger(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    supplier_party_resp = client.post(
        "/api/parties",
        json={
            "name": "Apex Mills",
            "party_type": "Supplier",
            "opening_balance": 500.0,
            "remarks": "Supplier for material purchases",
        },
    )
    assert supplier_party_resp.status_code == 200, supplier_party_resp.text
    supplier_party = supplier_party_resp.json()

    material_resp = client.post(
        "/api/material-inventory",
        json={
            "date": "2026-02-01",
            "material_name": "Interlining",
            "supplier": "Apex Mills",
            "quantity": 25,
            "unit": "kg",
            "rate": 8,
            "notes": "Demo purchase",
        },
    )
    assert material_resp.status_code == 200, material_resp.text

    supplier_ledger_resp = client.get(
        "/api/party-ledger",
        params={"party_type": "Supplier", "party_id": supplier_party["id"]},
    )
    assert supplier_ledger_resp.status_code == 200, supplier_ledger_resp.text
    supplier_payload = supplier_ledger_resp.json()
    assert any(entry["module_name"] == "Material Purchase" for entry in supplier_payload["entries"])

    vendor_party_resp = client.post(
        "/api/parties",
        json={
            "name": "Kumar Garments",
            "party_type": "Vendor",
            "opening_balance": 1000.0,
            "remarks": "Vendor used for payment transaction test",
        },
    )
    assert vendor_party_resp.status_code == 200, vendor_party_resp.text
    party = vendor_party_resp.json()

    payable_resp = client.post(
        "/api/payables",
        json={
            "vendor": "Kumar Garments",
            "reference_no": "PV-TEST-1",
            "source": "Job Work",
            "total_amount": 300.0,
            "paid_amount": 0.0,
            "due_date": "2026-03-01",
            "notes": "Open payable",
        },
    )
    assert payable_resp.status_code == 200, payable_resp.text
    payable = payable_resp.json()

    transaction_resp = client.post(
        "/api/payment-transactions",
        json={
            "date": "2026-02-10",
            "transaction_type": "Payment Given",
            "party": "Kumar Garments",
            "reference_no": "TX-1",
            "payable_id": payable["id"],
            "amount": 100.0,
            "payment_mode": "Cash",
            "notes": "advance payment",
        },
    )
    assert transaction_resp.status_code == 200, transaction_resp.text

    vendor_ledger_resp = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert vendor_ledger_resp.status_code == 200, vendor_ledger_resp.text
    vendor_payload = vendor_ledger_resp.json()
    assert any(entry["module_name"] == "Transactions" for entry in vendor_payload["entries"])

    patched_resp = client.patch(
        f"/api/payment-transactions/{transaction_resp.json()['id']}",
        json={"amount": 150.0},
    )
    assert patched_resp.status_code == 200, patched_resp.text

    vendor_ledger_updated = client.get(
        "/api/party-ledger",
        params={"party_type": "Vendor", "party_id": party["id"]},
    )
    assert vendor_ledger_updated.status_code == 200, vendor_ledger_updated.text
    updated_entries = vendor_ledger_updated.json()["entries"]
    transaction_entry = next(entry for entry in updated_entries if entry["module_name"] == "Transactions")
    assert transaction_entry["credit"] == 150.0
    assert transaction_entry["running_balance"] == 850.0
