#!/usr/bin/env python3
"""
IZINET — Patch Xray config.json directly with routing rules.
Run AFTER x3-ui starts and generates the config file.
This bypasses 3x-ui's broken xrayTemplateConfig persistence.
"""

import json
import os
import sys

CONFIG_PATH = '/app/bin/config.json'

ROUTING_RULES = [
    {
        "type": "field",
        "inboundTag": ["api"],
        "outboundTag": "api",
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "blocked",
        "domain": ["geosite:category-ads-all"],
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "direct",
        "domain": ["geosite:ru-available-only-inside"],
        "izinet_managed": True
    },
    {
        "type": "field",
        "outboundTag": "direct",
        "ip": ["geoip:ru", "geoip:private"],
        "izinet_managed": True
    }
]


def patch():
    if not os.path.exists(CONFIG_PATH):
        print(f"❌ Config not found: {CONFIG_PATH}")
        return False

    with open(CONFIG_PATH) as f:
        config = json.load(f)

    # Add/update routing
    if 'routing' not in config:
        config['routing'] = {}

    config['routing']['domainStrategy'] = 'IPIfNonMatch'
    config['routing']['rules'] = ROUTING_RULES

    # Ensure outbounds exist
    if 'outbounds' not in config:
        config['outbounds'] = [
            {"protocol": "freedom", "tag": "direct"},
            {"protocol": "blackhole", "tag": "blocked"}
        ]

    # Write back
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

    print(f"✅ Patched {CONFIG_PATH}")
    print(f"   domainStrategy: IPIfNonMatch")
    print(f"   rules: {len(ROUTING_RULES)} (api, ads-block, ru-direct, ip-direct)")
    return True


if __name__ == "__main__":
    print("=" * 50)
    print("  IZINET — Patch Xray config.json routing")
    print("=" * 50)
    if patch():
        print("\nRestart Xray to apply: kill -USR1 $(pgrep xray) or restart x3-ui")
    else:
        print("\nFailed to patch")
