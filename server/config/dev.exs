import Config

# Listens on every network address so the tablets on the home Wi-Fi can reach
# it at http://<this computer's address>:4000.
config :family, FamilyWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: String.to_integer(System.get_env("PORT") || "4000")],
  check_origin: false,
  code_reloader: false,
  debug_errors: false

# Also serves https on 4443 with a self-signed certificate, because tablets
# only allow the camera for video calls on a secure address.
config :family, https_port: 4443

config :logger, :default_formatter, format: "[$level] $message\n"
config :logger, level: :info
config :phoenix, :plug_init_mode, :runtime
