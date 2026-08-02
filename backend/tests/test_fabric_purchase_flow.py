from pathlib import Path
import sys
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import app


def test_fabric_purchase_and_dispatch_create_linked_payables_and_receivables():
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

    payables_resp = client.get("/api/payables")
    assert payables_resp.status_code == 200
    payables = payables_resp.json()
    linked_payable = next(
        (item for item in payables if item.get("notes", "").endswith(f"fabric_lot_id:{lot['id']}")),
        None,
    )
    assert linked_payable is not None
    assert linked_payable["total_amount"] == 250.0

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Vendor Test", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot["id"],
            "vendor_id": vendor_resp.json()["id"],
            "date": "2026-02-02",
            "kg_dispatched": 2,
            "notes": "dispatch for production",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text
    dispatch = dispatch_resp.json()

    receivables_resp = client.get("/api/receivables")
    assert receivables_resp.status_code == 200
    receivables = receivables_resp.json()
    linked_receivable = next(
        (item for item in receivables if item.get("notes", "").endswith(f"fabric_dispatch_id:{dispatch['id']}")),
        None,
    )
    assert linked_receivable is not None
    assert linked_receivable["total_amount"] == 50.0
