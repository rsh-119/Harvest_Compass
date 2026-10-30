"""Farmers and mandis run on Indian time. Servers often run on UTC, so never use date.today()."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def today_ist() -> date:
    return datetime.now(IST).date()
