import Config

config :family,
  ecto_repos: [Family.Repo],
  # Family app settings shown in the UI.
  app_name: "Kitchen Table",
  # Where invitations go: :outbox keeps them in the app for an admin to read,
  # :smtp sends real email (set it up in runtime.exs).
  mailer: :outbox,
  password_iterations: 600_000,
  # How devices in a video call find each other. At home they connect
  # directly; the public STUN server helps across networks. A TURN server
  # (set TURN_URL in runtime.exs) relays when nothing else gets through.
  ice_servers: [%{urls: ["stun:stun.l.google.com:19302"]}],
  # The family's own time zone, for calendar times that don't say theirs.
  time_zone: "Europe/London"

config :family, FamilyWeb.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  render_errors: [formats: [json: FamilyWeb.ErrorJSON], layout: false],
  pubsub_server: Family.PubSub

config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

config :phoenix, :json_library, Jason

# Linked calendars send local times with their time zone's name.
config :elixir, :time_zone_database, Tz.TimeZoneDatabase

import_config "#{config_env()}.exs"
