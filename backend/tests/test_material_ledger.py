from pathlib import Path
import sys
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from server import app


def test_material_ledger_generates_purchase_and_dispatch_entries():
    client = TestClient(app)
    material_name = f"Cotton-{uuid4().hex[:8]}"

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Ledger Vendor", "type": "third_party", "contact": "", "location": ""},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    inventory_resp = client.post(
        "/api/material-inventory",
        json={
            "date": "2026-02-01",
            "material_name": material_name,
            "supplier": "Ledger Supplier",
            "quantity": 10,
            "unit": "kg",
            "rate": 20,
            "notes": "ledger purchase",
        },
    )
    assert inventory_resp.status_code == 200, inventory_resp.text

    dispatch_resp = client.post(
        "/api/material-dispatches",
        json={
            "date": "2026-02-02",
            "dispatch_no": f"MD-LEDGER-{uuid4().hex[:8]}",
            "vendor_id": vendor_resp.json()["id"],
            "material_name": material_name,
            "quantity": 4,
            "unit": "kg",
            "purpose": "Production",
            "notes": "ledger dispatch",
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    ledger_resp = client.get("/api/material-ledger")
    assert ledger_resp.status_code == 200, ledger_resp.text
    payload = ledger_resp.json()

    rows = payload["rows"]
    assert len(rows) >= 2

    purchase = next(item for item in rows if item["transaction_type"] == "Purchase" and item["material"] == material_name)
    dispatch = next(item for item in rows if item["transaction_type"] == "Dispatch" and item["material"] == material_name)

    assert purchase["material"] == material_name
    assert purchase["qty_in"] == 10.0
    assert purchase["qty_out"] == 0.0
    assert purchase["balance"] == 10.0
    assert purchase["payment_status"] in {"Pending", "Partial", "Paid"}

    assert dispatch["material"] == material_name
    assert dispatch["qty_in"] == 0.0
    assert dispatch["qty_out"] == 4.0
    assert dispatch["balance"] == 6.0
