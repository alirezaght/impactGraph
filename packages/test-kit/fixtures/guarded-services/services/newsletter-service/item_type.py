from enum import Enum


class ItemType(str, Enum):
    GESUCH = "gesuch"
    IMMOBILIE = "immobilie"
    BETEILIGUNG = "beteiligung"
