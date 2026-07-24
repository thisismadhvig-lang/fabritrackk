from erp_service import (
    create_buyer,
    create_fabric_dispatch,
    create_fabric_lot,
    create_product_type,
    list_buyers,
    list_fabric_lots,
)
from database import get_session


def test_master_data_and_fabric_flow_roundtrip():
    session = get_session()
    try:
        company = session.query(type("Company", (), {"id": None}))
    finally:
        session.close()
