import Config

# Everything the app keeps (the database, photos and doodles, the secret key)
# lives in one folder, so a backup is one copy of it.
data_dir =
  System.get_env("FAMILY_DATA_DIR") ||
    Application.get_env(:family, :data_dir) ||
    Path.expand("../data", __DIR__)

File.mkdir_p!(data_dir)
config :family, data_dir: data_dir

if config_env() != :test do
  # The log is also kept in the data folder (three files of 5 MB at most), so
  # there's something to look back at when a call wouldn't connect.
  File.mkdir_p!(Path.join(data_dir, "log"))

  config :family, :logger, [
    {:handler, :file_log, :logger_std_h,
     %{
       config: %{file: String.to_charlist(Path.join([data_dir, "log", "server.log"])), max_no_bytes: 5_000_000, max_no_files: 3},
       formatter: Logger.Formatter.new(format: "$date $time [$level] $message\n")
     }}
  ]
end

if config_env() != :test do
  config :family, Family.Repo,
    database: System.get_env("DATABASE_PATH") || Path.join(data_dir, "family_#{config_env()}.db"),
    pool_size: 5

  # The key that signs sign-in cookies. Made once and kept in the data folder
  # unless SECRET_KEY_BASE is set.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      (fn ->
         path = Path.join(data_dir, "secret_key_base")

         case File.read(path) do
           {:ok, key} when byte_size(key) >= 64 ->
             String.trim(key)

           _ ->
             key = :crypto.strong_rand_bytes(48) |> Base.url_encode64(padding: false)
             File.write!(path, key)
             key
         end
       end).()

  config :family, FamilyWeb.Endpoint, secret_key_base: secret_key_base, server: true

  port = String.to_integer(System.get_env("PORT") || "4000")

  if host = System.get_env("PHX_HOST") do
    # On the internet (the VPS): Caddy on the same machine serves
    # https://PHX_HOST and passes requests to this port, which only listens
    # on the machine itself. The first admin needs the setup code.
    config :family, FamilyWeb.Endpoint,
      url: [host: host, port: 443, scheme: "https"],
      check_origin: ["https://#{host}"],
      http: [ip: {127, 0, 0, 1}, port: port]

    config :family,
      behind_proxy: true,
      https_port: nil,
      setup_code: System.get_env("SETUP_CODE") || true
  else
    if System.get_env("PORT") do
      config :family, FamilyWeb.Endpoint, http: [ip: {0, 0, 0, 0}, port: port]
    end
  end

  # MOVED_TO=https://new.address sends everyone there (see FamilyWeb.Endpoint).
  if moved = System.get_env("MOVED_TO") do
    config :family, moved_to: String.trim_trailing(String.trim(moved), "/")
  end

  # HTTPS_PORT=off turns off the home https address (see FamilyWeb.HomeHTTPS).
  case System.get_env("HTTPS_PORT") do
    nil -> :ok
    "off" -> config :family, https_port: nil
    https -> config :family, https_port: String.to_integer(https)
  end

  if turn = System.get_env("TURN_URL") do
    config :family,
      ice_servers: [
        %{urls: ["stun:stun.l.google.com:19302"]},
        %{
          urls: String.split(turn, ","),
          username: System.get_env("TURN_USERNAME"),
          credential: System.get_env("TURN_PASSWORD")
        }
      ]
  end

  # Linked calendars are fetched from the internet only. CALENDAR_PRIVATE_HOSTS=1
  # lets them come from the home network too (a Nextcloud at home, say).
  if System.get_env("CALENDAR_PRIVATE_HOSTS") in ["1", "true"] do
    config :family, calendar_private_hosts: true
  end

  # Linking Google and Outlook calendars both ways needs an app registered
  # with Google and with Microsoft in the name of whoever runs this server
  # (docs/calendar-sign-in.md). Their client IDs and secrets can go here, or
  # an admin can paste them in under Linked calendars instead.
  clients =
    for {provider, prefix} <- [{"google", "GOOGLE"}, {"microsoft", "MICROSOFT"}],
        id = System.get_env("#{prefix}_CLIENT_ID"),
        secret = System.get_env("#{prefix}_CLIENT_SECRET"),
        id not in [nil, ""] and secret not in [nil, ""],
        into: %{},
        do: {provider, {String.trim(id), String.trim(secret)}}

  if clients != %{}, do: config(:family, connect_clients: clients)

  # Only work or school accounts from one organisation: its tenant ID. The
  # default, "common", also takes personal Outlook.com and Hotmail accounts.
  if tenant = System.get_env("MICROSOFT_TENANT") do
    config :family, microsoft_tenant: tenant
  end

  # For testing: Google's and Microsoft's sign-in and calendars, played by a
  # stand-in at this address.
  if stand_in = System.get_env("CALENDAR_CONNECT_STAND_IN") do
    base = String.trim_trailing(stand_in, "/")

    config :family,
      connect_urls: %{
        google_accounts: base <> "/google-accounts",
        google_oauth: base <> "/google-oauth",
        google_api: base <> "/google-api",
        microsoft_login: base <> "/microsoft-login",
        microsoft_graph: base <> "/microsoft-graph"
      }
  end

  # Notifications go to the browsers' push services on the internet.
  # PUSH_PRIVATE_HOSTS=1 also allows ones on this network, for testing.
  if System.get_env("PUSH_PRIVATE_HOSTS") in ["1", "true"] do
    config :family, push_private_hosts: true
  end

  # Push services like a way to reach whoever runs the server: a mailto: or
  # https: address. The site's own address is used if this isn't set.
  if contact = System.get_env("PUSH_CONTACT") do
    config :family, push_contact: contact
  end

  # The family's time zone, for calendar times that don't say theirs.
  if zone = System.get_env("FAMILY_TIME_ZONE") do
    config :family, time_zone: zone
  end

  if System.get_env("SMTP_HOST") do
    config :family,
      mailer: :smtp,
      smtp: [
        host: System.fetch_env!("SMTP_HOST"),
        port: String.to_integer(System.get_env("SMTP_PORT") || "587"),
        username: System.get_env("SMTP_USERNAME"),
        password: System.get_env("SMTP_PASSWORD"),
        from: System.get_env("SMTP_FROM") || "family@localhost"
      ]
  end
end
