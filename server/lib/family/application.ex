defmodule Family.Application do
  @moduledoc false
  use Application
  require Logger

  @impl true
  def start(_type, _args) do
    Logger.add_handlers(:family)
    FamilyWeb.HomeHTTPS.configure()

    children = [
      Family.Repo,
      {Ecto.Migrator, repos: [Family.Repo], skip: System.get_env("SKIP_MIGRATIONS") == "true"},
      {Phoenix.PubSub, name: Family.PubSub},
      Family.RateLimit,
      {Task.Supervisor, name: Family.TaskSupervisor},
      Family.Games.Referee,
      Family.Calls,
      Family.Calendar.Links.Sync,
      FamilyWeb.Presence,
      FamilyWeb.Endpoint
    ]

    Supervisor.start_link(children, strategy: :one_for_one, name: Family.Supervisor)
  end

  @impl true
  def config_change(changed, _new, removed) do
    FamilyWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
