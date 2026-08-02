from pathlib import Path
import sys
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import app


def test_material_inventory_and_dispatch_create_accounting_records():
    client = TestClient(app)
    material_name = f"Thread-TEST-{uuid4().hex[:8]}"

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Test", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    inventory_resp = client.post(
        "/api/material-inventory",
        json={
            "date": "2026-01-01",
            "material_name": material_name,
            "supplier": "Supplier A",
            "quantity": 10,
            "unit": "roll",
            "rate": 25,
            "notes": "test inventory",
        },
    )
    assert inventory_resp.status_code == 200, inventory_resp.text
    inventory = inventory_resp.json()
    assert inventory["amount"] == 250.0

    dispatch_resp = client.post(
        "/api/material-dispatches",
        json={
            "date": "2026-01-02",
            "dispatch_no": f"MD-TEST-{uuid4().hex[:8]}",
            "vendor_id": vendor_resp.json()["id"],
            "material_name": material_name,
            "quantity": 4,
            "unit": "roll",
            "purpose": "Production",
            "notes": "test dispatch",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch = dispatch_resp.json()
    assert dispatch["quantity"] == 4.0

    payables_resp = client.get("/api/payables")
    assert payables_resp.status_code == 200
    payables = payables_resp.json()
    linked_payable = next(
        (item for item in payables if item.get("notes", "").endswith(f"material_inventory_id:{inventory['id']}")),
        None,
    )
    assert linked_payable is not None
    assert linked_payable["total_amount"] == 250.0

    receivables_resp = client.get("/api/receivables")
    assert receivables_resp.status_code == 200
    receivables = receivables_resp.json()
    linked_receivable = next(
        (item for item in receivables if item.get("notes", "").endswith(f"material_dispatch_id:{dispatch['id']}")),
        None,
    )
    assert linked_receivable is not None
    assert linked_receivable["total_amount"] == 100.0

    inventory_after = client.get("/api/material-inventory").json()
    matching_inventory = next(item for item in inventory_after if item["id"] == inventory["id"])
    assert matching_inventory["quantity"] == 6.0


def test_material_dispatch_creates_linked_adjustment_and_transaction_once():
    client = TestClient(app)
    material_name = f"Thread-ADJ-{uuid4().hex[:8]}"

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Adjustment", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    inventory_resp = client.post(
        "/api/material-inventory",
        json={
            "date": "2026-02-01",
            "material_name": material_name,
            "supplier": "Supplier B",
            "quantity": 8,
            "unit": "roll",
            "rate": 10,
            "notes": "adjustment test inventory",
        },
    )
    assert inventory_resp.status_code == 200, inventory_resp.text

    dispatch_no = f"MD-ADJ-{uuid4().hex[:8]}"
    dispatch_resp = client.post(
        "/api/material-dispatches",
        json={
            "date": "2026-02-02",
            "dispatch_no": dispatch_no,
            "vendor_id": vendor_resp.json()["id"],
            "material_name": material_name,
            "quantity": 2,
            "unit": "roll",
            "purpose": "Production",
            "notes": "adjustment dispatch",
            "rate": 10,
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch = dispatch_resp.json()

    payables = client.get("/api/payables").json()
    adjustment_payable = next(
        (item for item in payables if f"material_dispatch_id:{dispatch['id']}" in str(item.get("notes", ""))),
        None,
    )
    assert adjustment_payable is not None
    assert adjustment_payable["total_amount"] == 20.0
    assert adjustment_payable["total_material_adjustment"] == 20.0
    assert adjustment_payable["net_payable_amount"] == 20.0
    assert adjustment_payable["outstanding_balance"] == 20.0

    transactions = client.get("/api/payment-transactions").json()
    adjustment_transactions = [
        item for item in transactions
        if item.get("transaction_type") == "Adjustment" and item.get("payable_id") == adjustment_payable["id"]
    ]
    assert len(adjustment_transactions) == 1
    assert adjustment_transactions[0]["amount"] == 20.0

    update_resp = client.patch(
        f"/api/material-dispatches/{dispatch['id']}",
        json={"quantity": 3, "notes": "adjustment dispatch updated"},
    )
    assert update_resp.status_code == 200, update_resp.text

    payables_after = client.get("/api/payables").json()
    adjustment_payable_after = next(
        (item for item in payables_after if item.get("id") == adjustment_payable["id"]),
        None,
    )
    assert adjustment_payable_after is not None
    assert adjustment_payable_after["total_amount"] == 30.0
    assert adjustment_payable_after["total_material_adjustment"] == 30.0
    assert adjustment_payable_after["net_payable_amount"] == 30.0

    transactions_after = client.get("/api/payment-transactions").json()
    adjustment_transactions_after = [
        item for item in transactions_after
        if item.get("transaction_type") == "Adjustment" and item.get("payable_id") == adjustment_payable["id"]
    ]
    assert len(adjustment_transactions_after) == 1
    assert adjustment_transactions_after[0]["amount"] == 30.0
