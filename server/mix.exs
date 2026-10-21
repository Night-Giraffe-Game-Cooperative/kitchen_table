defmodule Family.MixProject do
  use Mix.Project

  def project do
    [
      app: :family,
      version: "0.1.0",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      releases: [family: [include_executables_for: [:unix]]],
      lockfile: if(git_deps?(), do: "mix.git.lock", else: "mix.lock")
    ]
  end

  def application do
    [
      mod: {Family.Application, []},
      extra_applications: [:logger, :runtime_tools, :crypto, :ssl, :public_key, :xmerl]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Hex packages, as on any normal machine. Set FAMILY_GIT_DEPS=1 to fetch the
  # same versions from GitHub instead, for build boxes that cannot reach hex.pm.
  defp deps, do: if(git_deps?(), do: git_deps(), else: hex_deps())

  defp git_deps?, do: System.get_env("FAMILY_GIT_DEPS") in ["1", "true"]

  defp hex_deps do
    [
      {:phoenix, "~> 1.8.15"},
      {:phoenix_pubsub, "~> 2.4"},
      {:bandit, "~> 1.13"},
      {:ecto_sql, "~> 3.14"},
      {:ecto_sqlite3, "~> 0.25"},
      {:jason, "~> 1.4"},
      # Talking to other people's calendars: Mint speaks WebDAV's methods, and
      # tz turns their local times into UTC.
      {:mint, "~> 1.7"},
      {:tz, "~> 0.28"}
    ]
  end

  # Every package in the tree, pinned to the tag that matches its hex release.
  defp git_deps do
    [
      {:phoenix, "phoenixframework/phoenix", "v1.8.15"},
      {:plug, "elixir-plug/plug", "v1.20.3"},
      {:plug_crypto, "elixir-plug/plug_crypto", "v2.2.0"},
      {:mime, "elixir-plug/mime", "v2.0.7"},
      {:telemetry, "beam-telemetry/telemetry", "v1.4.2"},
      {:phoenix_pubsub, "phoenixframework/phoenix_pubsub", "v2.4.1"},
      {:phoenix_template, "phoenixframework/phoenix_template", "v1.0.4"},
      {:websock_adapter, "phoenixframework/websock_adapter", "0.6.0"},
      {:websock, "phoenixframework/websock", "0.5.3"},
      {:bandit, "mtrudel/bandit", "1.13.1"},
      {:thousand_island, "mtrudel/thousand_island", "1.6.0"},
      {:hpax, "elixir-mint/hpax", "v1.1.0"},
      {:ecto, "elixir-ecto/ecto", "v3.14.2"},
      {:ecto_sql, "elixir-ecto/ecto_sql", "v3.14.0"},
      {:ecto_sqlite3, "elixir-sqlite/ecto_sqlite3", "v0.25.0"},
      {:exqlite, "elixir-sqlite/exqlite", "v0.42.0"},
      {:db_connection, "elixir-ecto/db_connection", "v2.10.2"},
      {:decimal, "ericmj/decimal", "v3.2.0"},
      {:jason, "michalmuskala/jason", "v1.4.5"},
      {:elixir_make, "elixir-lang/elixir_make", "v0.10.0"},
      {:cc_precompiler, "cocoa-xu/cc_precompiler", "v0.1.11"},
      {:mint, "elixir-mint/mint", "v1.7.1"},
      {:tz, "mathieuprog/tz", "v0.28.4"}
    ]
    |> Enum.map(fn {app, repo, tag} -> {app, github: repo, tag: tag, override: true} end)
  end

  defp aliases do
    [
      setup: ["deps.get", "ecto.create", "ecto.migrate"],
      "ecto.reset": ["ecto.drop", "ecto.create", "ecto.migrate"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"]
    ]
  end
end
