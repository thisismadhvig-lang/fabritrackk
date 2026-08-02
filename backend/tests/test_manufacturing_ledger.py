from ledger_service import build_manufacturing_ledger


def test_build_manufacturing_ledger_groups_dispatches_with_related_returns():
    dispatches = [
        {
            "id": "dispatch-1",
            "dispatch_no": "DIS-1001",
            "vendor_id": "vendor-1",
            "vendor_name": "Alpha Unit",
            "product_type_id": "product-1",
            "kg_dispatched": 120,
            "expected_pieces": 20,
            "avg_fabric_per_piece": 6,
            "date": "2025-01-05T00:00:00",
            "challan_no": "CH-001",
        }
    ]
    returns = [
        {
            "id": "return-1",
            "dispatch_id": "dispatch-1",
            "dispatch_no": "DIS-1001",
            "vendor_id": "vendor-1",
            "vendor_name": "Alpha Unit",
            "product_type_id": "product-1",
            "pieces_received": 12,
            "pieces_defected": 2,
            "kg_used": 70,
            "fabric_returned_kg": 10,
            "cutting_waste_kg": 5,
            "job_work_rate_per_piece": 150,
            "date": "2025-01-10T00:00:00",
            "challan_no": "CH-001",
            "lot_no": "LOT-7",
            "article_barcode": "ART-77",
            "notes": "Good receipt",
        }
    ]
    payments = [
        {
            "id": "payment-1",
            "party": "Alpha Unit",
            "reference_no": "CH-001",
            "amount": 1800,
            "notes": "Settlement for CH-001",
        }
    ]

    payload = build_manufacturing_ledger(dispatches, returns, payments)

    assert payload["summary"]["total_dispatched_kg"] == 120.0
    assert payload["summary"]["total_pieces_received"] == 12
    assert payload["summary"]["total_pieces_pending"] == 8
    assert len(payload["groups"]) == 1
    assert payload["groups"][0]["dispatch_no"] == "DIS-1001"
    assert payload["groups"][0]["pieces_received_total"] == 12
    assert payload["groups"][0]["pieces_pending"] == 8
    assert payload["groups"][0]["rows"][0]["payment_status"] == "Settled"
    assert payload["groups"][0]["rows"][0]["job_work_amount"] == 1800.0
