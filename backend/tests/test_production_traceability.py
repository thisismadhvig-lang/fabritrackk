import pytest
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_production_traceability_article_view_aggregates_live_data(client):
    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    buyer_resp = client.post(
        "/api/buyers",
        json={"name": "Apex Buyers", "contact": "Apex", "country": "India", "type": "local"},
    )
    assert buyer_resp.status_code == 200, buyer_resp.text
    buyer = buyer_resp.json()

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
    vendor = vendor_resp.json()

    order_resp = client.post(
        "/api/orders",
        json={
            "order_number": "ORD-TRACE-1",
            "buyer_id": buyer["id"],
            "product_type_id": product["id"],
            "quantity": 12,
            "unit_price": 250.0,
            "delivery_date": "2026-05-10",
            "notes": "",
        },
    )
    assert order_resp.status_code == 200, order_resp.text
    order = order_resp.json()

    lot_resp = client.post(
        "/api/fabric-lots",
        json={
            "fabric_type": "Cotton",
            "color": "Navy",
            "supplier": vendor["name"],
            "kg_received": 50.0,
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
            "vendor_id": vendor["id"],
            "order_id": order["id"],
            "product_type_id": product["id"],
            "kg_dispatched": 20.0,
            "date": "2026-05-02",
            "notes": '{"dispatchNo": "FD-1001", "expectedPieces": 10, "avgFabricPerPiece": 1.0, "fabricName": "Cotton", "brandName": "PREM", "productTypeName": "Formal Shirt", "quantity": 5, "rolls": 2, "unit": "kg"}',
        },
    )
    assert dispatch_resp.status_code == 200, dispatch_resp.text

    return_resp = client.post(
        "/api/production-returns",
        json={
            "dispatch_id": dispatch_resp.json()["id"],
            "product_type_id": product["id"],
            "pieces_received": 8,
            "pieces_defected": 1,
            "kg_used": 3.0,
            "fabric_returned_kg": 0.5,
            "cutting_waste_kg": 0.2,
            "job_work_rate_per_piece": 5.0,
            "date": "2026-05-03",
            "notes": "Finished goods ready for warehouse",
            "challan_no": "CH-1001",
            "lot_no": "LOT-800",
            "article_barcode": "A101",
        },
    )
    assert return_resp.status_code == 200, return_resp.text

    shipment_resp = client.post(
        "/api/shipments",
        json={
            "shipment_no": "SHIP-1001",
            "shipment_date": "2026-05-04",
            "customer": buyer["name"],
            "invoice_no": "INV-1001",
            "transport": "Truck",
            "products": [
                {
                    "article_number": "A101",
                    "brand": "PREM",
                    "product_type_id": product["id"],
                    "product_type_name": product["name"],
                    "available_pieces": 8,
                    "dispatch_quantity": 6,
                    "unit": "pcs",
                }
            ],
        },
    )
    assert shipment_resp.status_code == 200, shipment_resp.text

    trace_resp = client.get("/api/production-traceability", params={"view": "article", "search": "A101"})
    assert trace_resp.status_code == 200, trace_resp.text

    payload = trace_resp.json()
    assert payload["view"] == "article"
    assert payload["article"]["article_number"] == "A101"
    assert payload["article"]["product_name"] == "Formal Shirt"
    assert payload["dispatches"][0]["dispatch_no"] == "FD-1001"
    assert payload["returns"][0]["challan_no"] == "CH-1001"
    assert payload["shipments"][0]["shipment_no"] == "SHIP-1001"
