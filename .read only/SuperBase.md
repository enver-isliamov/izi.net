## Table `users`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `varchar` |  Unique |
| `password_hash` | `varchar` |  Nullable |
| `name` | `varchar` |  Nullable |
| `telegram_id` | `varchar` |  Nullable |
| `telegram_linked` | `bool` |  Nullable |
| `email_verified` | `bool` |  Nullable |
| `referral_code` | `varchar` |  Nullable Unique |
| `referred_by` | `uuid` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |
| `role` | `text` |  Nullable |

## Table `balances`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable Unique |
| `amount` | `numeric` |  Nullable |
| `currency` | `varchar` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |

## Table `subscriptions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable Unique |
| `plan_type` | `varchar` |  Nullable |
| `status` | `varchar` |  Nullable |
| `traffic_limit_mb` | `int8` |  Nullable |
| `traffic_used_mb` | `int8` |  Nullable |
| `device_limit` | `int4` |  Nullable |
| `devices_connected` | `int4` |  Nullable |
| `server_type` | `varchar` |  Nullable |
| `period_months` | `int4` |  Nullable |
| `expires_at` | `timestamp` |  Nullable |
| `created_at` | `timestamp` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |
| `v2ray_config` | `text` |  Nullable |
| `server_id` | `uuid` |  Nullable |

## Table `devices`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `subscription_id` | `uuid` |  Nullable |
| `name` | `varchar` |  Nullable |
| `config_link` | `varchar` |  Nullable |
| `last_connected` | `timestamp` |  Nullable |
| `created_at` | `timestamp` |  Nullable |

## Table `referrals`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `referrer_id` | `uuid` |  Nullable |
| `referee_id` | `uuid` |  Nullable |
| `commission_earned` | `numeric` |  Nullable |
| `status` | `varchar` |  Nullable |
| `created_at` | `timestamp` |  Nullable |

## Table `payments`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `amount` | `numeric` |  Nullable |
| `currency` | `varchar` |  Nullable |
| `payment_method` | `varchar` |  Nullable |
| `status` | `varchar` |  Nullable |
| `payment_link` | `varchar` |  Nullable |
| `expires_at` | `timestamp` |  Nullable |
| `completed_at` | `timestamp` |  Nullable |
| `created_at` | `timestamp` |  Nullable |

## Table `tickets`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `subject` | `varchar` |  Nullable |
| `message` | `text` |  Nullable |
| `status` | `varchar` |  Nullable |
| `attachment_url` | `varchar` |  Nullable |
| `created_at` | `timestamp` |  Nullable |

## Table `notification_settings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable Unique |
| `subscription_expiry_alert` | `bool` |  Nullable |
| `subscription_expiry_days` | `int4` |  Nullable |
| `traffic_warning_alert` | `bool` |  Nullable |
| `traffic_warning_percent` | `int4` |  Nullable |
| `low_balance_alert` | `bool` |  Nullable |
| `low_balance_threshold` | `numeric` |  Nullable |
| `news_alert` | `bool` |  Nullable |
| `promo_alert` | `bool` |  Nullable |

## Table `partner_applications`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  Nullable |
| `company_name` | `varchar` |  Nullable |
| `telegram_channel` | `varchar` |  Nullable |
| `website` | `varchar` |  Nullable |
| `description` | `text` |  Nullable |
| `expected_referrals` | `int4` |  Nullable |
| `desired_commission` | `int4` |  Nullable |
| `status` | `varchar` |  Nullable |
| `admin_notes` | `text` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `updated_at` | `timestamptz` |  Nullable |

## Table `transactions`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `amount` | `numeric` |  |
| `currency` | `varchar` |  Nullable |
| `type` | `varchar` |  Nullable |
| `status` | `varchar` |  Nullable |
| `description` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `support_tickets`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `user_id` | `uuid` |  |
| `subject` | `text` |  |
| `message` | `text` |  |
| `status` | `varchar` |  Nullable |
| `priority` | `varchar` |  Nullable |
| `created_at` | `timestamptz` |  |
| `updated_at` | `timestamptz` |  Nullable |

## Table `telegram_linking_tokens`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `token` | `text` | Primary |
| `user_id` | `uuid` |  Nullable |
| `created_at` | `timestamptz` |  Nullable |
| `expires_at` | `timestamptz` |  Nullable |

## Table `support_messages`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `ticket_id` | `uuid` |  |
| `sender` | `text` |  |
| `content` | `text` |  |
| `created_at` | `timestamptz` |  |

## Table `vpn_servers`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `ip` | `text` |  |
| `domain` | `text` |  Nullable |
| `api_port` | `int4` |  Nullable |
| `username` | `text` |  |
| `password` | `text` |  |
| `is_active` | `bool` |  Nullable |
| `location_code` | `text` |  Nullable |
| `created_at` | `timestamptz` |  |
| `xui_config_state` | `jsonb` |  Nullable |

## Table `settings`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `key` | `text` | Primary |
| `value` | `text` |  |
| `updated_at` | `timestamptz` |  Nullable |

## Table `profiles`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `email` | `text` |  Unique |
| `name` | `text` |  Nullable |
| `telegram_id` | `int8` |  Nullable Unique |
| `telegram_linked` | `bool` |  Nullable |
| `referral_code` | `text` |  Nullable Unique |
| `referred_by` | `uuid` |  Nullable |
| `is_admin` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  |

## Table `app_config`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `key` | `text` | Primary |
| `value` | `jsonb` |  |
| `updated_at` | `timestamptz` |  Nullable |

## Table `vpn_routing_rules`

### Columns

| Name | Type | Constraints |
|------|------|-------------|
| `id` | `uuid` | Primary |
| `name` | `text` |  |
| `domains` | `jsonb` |  Nullable |
| `ips` | `jsonb` |  Nullable |
| `outbound_tag` | `text` |  |
| `is_active` | `bool` |  Nullable |
| `created_at` | `timestamptz` |  |

