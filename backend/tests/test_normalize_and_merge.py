import pytest

from server import normalize_and_merge_records


def test_normalize_and_merge_records_prefers_latest_non_empty_value():
    records = [
        {"id": "a", "value": ""},
        {"id": "a", "value": "beta"},
        {"id": "b", "value": "gamma"},
    ]

    assert normalize_and_merge_records(records) == {"a": "beta", "b": "gamma"}


def test_normalize_and_merge_records_skips_empty_and_invalid_rows():
    records = [
        {"id": "a", "value": "   "},
        {"id": "b", "value": None},
        {"id": "c", "value": "delta"},
        {"id": "d", "value": "epsilon"},
        {"id": "e", "value": ""},
        "invalid",
        None,
    ]

    assert normalize_and_merge_records(records) == {"c": "delta", "d": "epsilon"}


def test_normalize_and_merge_records_supports_custom_fields():
    records = [
        {"sku": "sku-1", "qty": 0},
        {"sku": "sku-1", "qty": 5},
        {"sku": "sku-2", "qty": 3},
    ]

    assert normalize_and_merge_records(records, key_field="sku", value_field="qty") == {"sku-1": 5, "sku-2": 3}
