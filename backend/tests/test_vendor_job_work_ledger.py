import asyncio
from uuid import uuid4

from ledger_service import build_vendor_job_work_ledger
from server import vendor_ledger
from database import SessionLocal
from models import CompanyORM, VendorORM


def test_build_vendor_job_work_ledger_groups_dispatches_with_related_challans():
    dispatches = [
        {
            "id": "dispatch-1",
            "dispatch_no": "D-101",
            "vendor_id": "vendor-1",
            "vendor_name": "Kumar Garments",
            "product_type_id": "product-1",
            "fabric_lot_id": "lot-1",
            "kg_dispatched": 120,
            "expected_pieces": 20,
            "date": "2025-01-05T00:00:00",
            "notes": "",
        },
        {
            "id": "dispatch-2",
            "dispatch_no": "D-102",
            "vendor_id": "vendor-1",
            "vendor_name": "Kumar Garments",
            "product_type_id": "product-1",
            "fabric_lot_id": "lot-1",
            "kg_dispatched": 80,
            "expected_pieces": 15,
            "date": "2025-01-06T00:00:00",
            "notes": "",
        },
    ]
    returns = [
        {
            "id": "challan-1",
            "dispatch_id": "dispatch-1",
            "vendor_id": "vendor-1",
            "challan_no": "CH-001",
            "date": "2025-01-10T00:00:00",
            "article_barcode": "ART-100",
            "lot_no": "LOT-7",
            "pieces_received": 10,
            "pieces_defected": 1,
            "notes": "",
        },
        {
            "id": "challan-2",
            "dispatch_id": "dispatch-1",
            "vendor_id": "vendor-1",
            "challan_no": "CH-002",
            "date": "2025-01-11T00:00:00",
            "article_barcode": "ART-200",
            "lot_no": "LOT-8",
            "pieces_received": 5,
            "pieces_defected": 0,
            "notes": "",
        },
        {
            "id": "challan-3",
            "dispatch_id": "dispatch-2",
            "vendor_id": "vendor-1",
            "challan_no": "CH-010",
            "date": "2025-01-12T00:00:00",
            "article_barcode": "ART-300",
            "lot_no": "LOT-9",
            "pieces_received": 4,
            "pieces_defected": 0,
            "notes": "",
        },
    ]
    links = [
        {"dispatch_id": "dispatch-1", "challan_id": "challan-1"},
        {"dispatch_id": "dispatch-1", "challan_id": "challan-2"},
        {"dispatch_id": "dispatch-2", "challan_id": "challan-1"},
        {"dispatch_id": "dispatch-2", "challan_id": "challan-3"},
    ]

    payload = build_vendor_job_work_ledger(
        dispatches,
        returns,
        links,
        lots=[{"id": "lot-1", "fabric_type": "Cotton", "supplier": "Kumar Supplier"}],
        product_types=[{"id": "product-1", "name": "Formal Shirt"}],
    )

    assert payload["summary"]["total_dispatches"] == 2
    assert payload["summary"]["total_pieces_received"] == 19
    assert payload["summary"]["total_pieces_pending"] == 16
    assert len(payload["groups"]) == 2
    assert payload["groups"][0]["dispatch_no"] == "D-101"
    assert len(payload["groups"][0]["related_receipts"]) == 2
    assert payload["groups"][0]["related_receipts"][0]["challan_no"] == "CH-001"
    assert payload["groups"][1]["related_receipts"][0]["challan_no"] == "CH-001"


def test_build_vendor_job_work_ledger_uses_dispatch_brand_and_product_type_metadata():
    payload = build_vendor_job_work_ledger(
        [
            {
                "id": "dispatch-3",
                "dispatch_no": "D-103",
                "vendor_id": "vendor-1",
                "vendor_name": "Kumar Garments",
                "product_type_id": "product-1",
                "fabric_lot_id": "lot-1",
                "kg_dispatched": 100,
                "expected_pieces": 25,
                "date": "2025-01-07T00:00:00",
                "brand_name": "Brand X",
                "product_type_name": "T-Shirt",
                "notes": "",
            }
        ],
        [],
        [],
        lots=[{"id": "lot-1", "fabric_type": "Cotton", "supplier": "Kumar Supplier"}],
        product_types=[{"id": "product-1", "name": "Formal Shirt"}],
    )

    assert payload["groups"][0]["brand_name"] == "Brand X"
    assert payload["groups"][0]["product_type"] == "T-Shirt"


def test_vendor_ledger_endpoint_returns_empty_payload_for_unknown_vendor_without_crashing():
    with SessionLocal() as session:
        company_id = f"company-{uuid4().hex[:8]}"
        vendor_id = f"vendor-{uuid4().hex[:8]}"
        company = CompanyORM(id=company_id, name="Test Company", code=f"test-{uuid4().hex[:8]}", address="", contact_email="", contact_phone="")
        session.add(company)
        session.commit()
        session.refresh(company)

        vendor = VendorORM(id=vendor_id, company_id=company.id, name="Ledger Vendor", type="third_party", contact="", location="")
        session.add(vendor)
        session.commit()
        session.refresh(vendor)

    payload = asyncio.run(vendor_ledger(vendor.id))

    assert payload["summary"]["total_dispatches"] == 0
    assert payload["summary"]["total_pieces_received"] == 0
    assert payload["groups"] == []
