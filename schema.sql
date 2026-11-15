create table if not exists users (
  telegram_id bigint primary key,
  first_name text, last_name text, username text, photo_url text,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  referred_by bigint references users(telegram_id),
  referral_completed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists users_referred_by_idx on users(referred_by);
create table if not exists task_progress (
  telegram_id bigint not null references users(telegram_id),
  task_id int not null,
  started_at timestamptz, verified_at timestamptz, claimed_at timestamptz,
  primary key (telegram_id, task_id)
);
create table if not exists daily_claims (
  telegram_id bigint not null references users(telegram_id),
  claim_date date not null,
  primary key (telegram_id, claim_date)
);
create table if not exists withdrawals (
  id bigserial primary key,
  telegram_id bigint not null references users(telegram_id),
  address text not null, amount_cents bigint not null, fee_cents bigint not null,
  status text not null default 'Pending',
  created_at timestamptz not null default now()
);
alter table users enable row level security;
alter table task_progress enable row level security;
alter table daily_claims enable row level security;
alter table withdrawals enable row level security;
