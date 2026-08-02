import pytest
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_shipment_reduces_warehouse_stock_and_rejects_duplicates(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    product_resp = client.post(
        "/api/product-types",
        json={"name": "Formal Shirt", "avg_fabric_per_piece_kg": 0.25, "description": "Finished goods"},
    )
    assert product_resp.status_code == 200, product_resp.text
    product = product_resp.json()

    vendor_resp = client.post(
        "/api/vendors",
        json={"name": "Delta Works", "type": "third_party", "contact": "Delta", "location": "Mumbai"},
    )
    assert vendor_resp.status_code == 200, vendor_resp.text

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Navy",
            "supplier": "Delta Works",
            "kg_received": 100.0,
            "cost_per_kg": 12.0,
            "date_received": "2026-05-01",
            "notes": "",
        },
    )
    assert lot_resp.status_code == 200, lot_resp.text

    dispatch_resp = client.post(
        "/api/fabric-dispatches",
        json={
            "fabric_lot_id": lot_resp.json()["id"],
            "vendor_id": vendor_resp.json()["id"],
            "order_id": "ORDER-WH-2",
            "product_type_id": product["id"],
            "kg_dispatched": 20.0,
            "date": "2026-05-02",
            "notes": '{"dispatchNo": "FD-WH-200"}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    return_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_resp.json()["id"],
            "product_type_id": product["id"],
            "pieces_received": 12,
            "pieces_defected": 0,
            "kg_used": 3.0,
            "fabric_returned_kg": 0.5,
            "cutting_waste_kg": 0.2,
            "job_work_rate_per_piece": 5.0,
            "date": "2026-05-03",
            "notes": "Brand: BrandX | Warehouse Location: WH-A",
            "challan_no": "CH-2001",
            "lot_no": "LOT-900",
            "article_barcode": "ART-200",
        },
    )
    assert return_resp.status_code == 200, return_resp.text

    shipment_payload = {
        "shipment_no": "SH-100",
        "shipment_date": "2026-05-04",
        "customer": "North Star",
        "invoice_no": "INV-100",
        "transport": "Road",
        "vehicle_no": "MH-12-AB-1234",
        "lr_no": "LR-100",
        "destination": "Delhi",
        "remarks": "First dispatch",
        "products": [
            {
                "article_number": "ART-200",
                "brand": "BrandX",
                "product_type_id": product["id"],
                "product_type_name": "Formal Shirt",
                "available_pieces": 12,
                "dispatch_quantity": 5,
                "unit": "pcs",
            }
        ],
    }

    create_resp = client.post("/api/shipments", json=shipment_payload)
    assert create_resp.status_code == 200, create_resp.text

    warehouse_resp = client.get("/api/warehouse")
    assert warehouse_resp.status_code == 200, warehouse_resp.text
    row = next(item for item in warehouse_resp.json()["items"] if item["article_number"] == "ART-200")
    assert row["pieces_available"] == 7
    assert row["status"] == "Reserved"

    duplicate_resp = client.post("/api/shipments", json=shipment_payload)
    assert duplicate_resp.status_code == 400


def test_shipment_creates_receivable_and_payment_updates_balance(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    product_resp = client.post(
        "/api/product-types",
        json={"name": "Formal Shirt", "avg_fabric_per_piece_kg": 0.25, "description": "Finished goods"},
    )
    assert product_resp.status_code == 200, product_resp.text
    product = product_resp.json()

    shipment_resp = client.post(
        "/api/shipments",
        json={
            "shipment_no": "SH-200",
            "shipment_date": "2026-05-04",
            "customer": "North Star",
            "invoice_no": "INV-200",
            "products": [
                {
                    "article_number": "ART-200",
                    "brand": "BrandX",
                    "product_type_id": product["id"],
                    "product_type_name": "Formal Shirt",
                    "available_pieces": 12,
                    "dispatch_quantity": 4,
                    "unit": "pcs",
                }
            ],
        },
    )
    assert shipment_resp.status_code == 200, shipment_resp.text

    receivables_resp = client.get("/api/receivables")
    assert receivables_resp.status_code == 200, receivables_resp.text
    receivable = next(item for item in receivables_resp.json() if item["invoice_no"] == "INV-200")
    assert receivable["total_amount"] == 400.0
    assert receivable["balance_amount"] == 400.0
    assert receivable["status"] == "Pending"

    payment_resp = client.post(
        "/api/payment-transactions",
        json={
            "date": "2026-05-05",
            "transaction_type": "Payment Received",
            "party": "North Star",
            "reference_no": "RCPT-1",
            "receivable_id": receivable["id"],
            "amount": 150.0,
            "payment_mode": "Cash",
            "notes": "Advance receipt",
        },
    )
    assert payment_resp.status_code == 200, payment_resp.text

    updated_receivable_resp = client.get(f"/api/receivables")
    updated_receivable = next(item for item in updated_receivable_resp.json() if item["id"] == receivable["id"])
    assert updated_receivable["received_amount"] == 150.0
    assert updated_receivable["balance_amount"] == 250.0
    assert updated_receivable["status"] == "Partial"
