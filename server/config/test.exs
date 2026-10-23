import Config

config :family, Family.Repo,
  database: Path.expand("../data/family_test.db", __DIR__),
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: 5

config :family, FamilyWeb.Endpoint,
  http: [ip: {127, 0, 0, 1}, port: 4002],
  secret_key_base: String.duplicate("test-secret-", 8),
  server: false

config :family, password_iterations: 1_000, data_dir: Path.expand("../data/test", __DIR__)

config :logger, level: :warning
config :phoenix, :plug_init_mode, :runtime

# Tests copy linked calendars when they ask to, not on a timer, and the fake
# calendar server they talk to is on this machine.
config :family, calendar_sync_ticks: false, game_tidy_ticks: false, summary_ticks: false, calendar_private_hosts: true

# Notifications go out as they happen rather than in the background, to a
# fake push service on this machine.
config :family, push_sync: true, push_private_hosts: true

# Email set up in the app goes to a stand-in for an email server.
config :family, smtp_client: Family.FakeSMTP
