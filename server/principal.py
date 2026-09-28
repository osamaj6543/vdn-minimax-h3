"""Principal: who is calling, resolved from either auth backend.

- api-key principals: the static keys in VDN_API_KEYS (ops/legacy)
- appwrite principals: Appwrite JWTs minted by account.createJWT() on the
  frontend (id = "user:<appwrite-user-id>", tier from user labels)

Both carry a Tier, so rate limiting, quotas, priority ceilings and pool
routing work identically regardless of source.
"""
from dataclasses import dataclass, field
from typing import List


@dataclass(frozen=True)
class Principal:
    id: str
    tier_name: str
    source: str                      # "api-key" | "appwrite"
    email: str = ""
    name: str = ""
    labels: List[str] = field(default_factory=list)
