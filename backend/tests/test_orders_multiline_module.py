from fastapi.testclient import TestClient

from server import app


def test_orders_support_multiple_items_and_summary_totals():
    client = TestClient(app)

    login_resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin"},
    )
    assert login_resp.status_code == 200, login_resp.text

    buyer_resp = client.post(
        "/api/buyers",
        json={"name": "Apex", "contact": "Apex", "country": "India", "type": "export"},
    )
    assert buyer_resp.status_code == 200, buyer_resp.text

    order_resp = client.post(
        "/api/orders",
        json={
            "order_number": "ORD-1001",
            "buyer_id": buyer_resp.json()["id"],
            "order_status": "Confirmed",
            "order_type": "export",
            "payment_terms": "30 days",
            "currency": "USD",
            "notes": "Priority production",
            "items": [
                {
                    "product_type": "Formal Shirt",
                    "description": "Classic shirt",
                    "brand": "Apex",
                    "article_number": "ART-001",
                    "color": "Navy",
                    "size": "M",
                    "fabric": "Cotton",
                    "gsm": "180",
                    "quantity": 10,
                    "unit_price": 25.0,
                    "remarks": "First run",
                },
                {
                    "product_type": "Formal Pant",
                    "description": "Tailored pant",
                    "brand": "Apex",
                    "article_number": "ART-002",
                    "color": "Black",
                    "size": "32",
                    "fabric": "Linen",
                    "gsm": "220",
                    "quantity": 8,
                    "unit_price": 35.0,
                    "remarks": "Second run",
                },
            ],
        },
    )
    assert order_resp.status_code == 200, order_resp.text

    payload = order_resp.json()
    assert len(payload["items"]) == 2
    assert payload["total_product_types"] == 2
    assert payload["total_pieces"] == 18
    assert payload["subtotal"] == 10 * 25.0 + 8 * 35.0
    assert payload["grand_total"] == payload["subtotal"] + payload["tax"] - payload["discount"]

    detail_resp = client.get(f"/api/orders/{payload['id']}")
    assert detail_resp.status_code == 200, detail_resp.text
    assert detail_resp.json()["items"][0]["product_type"] == "Formal Shirt"
