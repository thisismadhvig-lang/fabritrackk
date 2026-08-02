import pytest
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_warehouse_stock_aggregates_returns_and_shipments(client):
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
            "order_id": "ORDER-WH-1",
            "product_type_id": product["id"],
            "kg_dispatched": 20.0,
            "date": "2026-05-02",
            "notes": '{"dispatchNo": "FD-WH-100"}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    return_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_resp.json()["id"],
            "product_type_id": product["id"],
            "pieces_received": 15,
            "pieces_defected": 1,
            "kg_used": 3.0,
            "fabric_returned_kg": 0.5,
            "cutting_waste_kg": 0.2,
            "job_work_rate_per_piece": 5.0,
            "date": "2026-05-03",
            "notes": "Finished goods ready for warehouse",
            "challan_no": "CH-1001",
            "lot_no": "LOT-800",
            "article_barcode": "ART-100",
        },
    )
    assert return_resp.status_code == 200, return_resp.text

    order_resp = client.post(
        "/api/orders",
        json={
            "order_number": "ORD-WH-1",
            "buyer_id": "",
            "product_type_id": product["id"],
            "quantity": 8,
            "unit_price": 250.0,
            "delivery_date": "2026-05-10",
            "notes": "",
        },
    )
    assert order_resp.status_code == 200, order_resp.text
    client.patch(f"/api/orders/{order_resp.json()['id']}/stage", json={"stage": "shipment"})

    warehouse_resp = client.get("/api/warehouse")
    assert warehouse_resp.status_code == 200, warehouse_resp.text
    payload = warehouse_resp.json()
    assert payload["items"]
    row = next(item for item in payload["items"] if item["article_number"] == "ART-100")
    assert row["pieces_available"] == 7
    assert row["status"] == "Reserved"
