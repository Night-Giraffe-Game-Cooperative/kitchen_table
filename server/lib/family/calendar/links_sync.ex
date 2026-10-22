defmodule Family.Calendar.Links.Sync do
  @moduledoc """
  Copies linked calendars here: CalDAV and Google ones every five minutes
  (it's quick to ask whether anything changed), Outlook ones every ten (they
  come in full each time), feeds every hour. One copy runs at a time, so a
  link is never copied twice at once. Now and then it also lets go of Google
  and Microsoft accounts someone signed in to but linked nothing from.
  """

  use GenServer
  require Logger
  import Ecto.Query
  alias Family.Repo
  alias Family.Calendar.{Link, Links}

  @tick :timer.minutes(1)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @doc "Copies one link now and waits for it."
  def now(id, opts \\ []) do
    GenServer.call(__MODULE__, {:sync, id, opts}, 120_000)
  catch
    :exit, reason ->
      Logger.warning("Calendar copying didn't finish: " <> (inspect(reason) |> String.slice(0, 200)))
      {:error, "That calendar is taking a long time to answer. It'll try again shortly."}
  end

  @impl true
  def init(_) do
    if ticking?(), do: Process.send_after(self(), :tick, :timer.seconds(20))
    {:ok, %{tidied: nil}}
  end

  @impl true
  def handle_call({:sync, id, opts}, _from, state) do
    result =
      try do
        case Links.get(id) do
          nil -> {:error, :not_found}
          link -> Links.pull(link, opts)
        end
      rescue
        e ->
          Logger.error("Calendar copying failed: " <> Exception.message(e))
          {:error, "Something went wrong copying this calendar. It'll try again shortly."}
      end

    {:reply, result, state}
  end

  # One link a tick at a most, the one waiting longest, so asking for a copy
  # never waits behind a long round of them.
  @impl true
  def handle_info(:tick, state) do
    now = DateTime.utc_now(:second)

    due =
      Repo.all(from l in Link, order_by: [asc_nulls_first: l.last_synced_at])
      |> Enum.find(&due?(&1, now))

    if due, do: Links.pull(due, [])
    Process.send_after(self(), :tick, if(due, do: 1000, else: @tick))

    if is_nil(state.tidied) or DateTime.diff(now, state.tidied) >= 3600 do
      Family.Calendar.Connect.tidy()
      {:noreply, %{state | tidied: now}}
    else
      {:noreply, state}
    end
  rescue
    e ->
      Logger.error("Calendar copying failed: " <> Exception.message(e))
      Process.send_after(self(), :tick, @tick)
      {:noreply, state}
  end

  defp due?(%Link{last_synced_at: nil}, _), do: true

  defp due?(%Link{} = link, now) do
    every =
      case {link.provider, link.last_error} do
        {_, error} when is_binary(error) -> 30
        {provider, _} when provider in ["caldav", "google"] -> 5
        {"microsoft", _} -> 10
        _ -> 60
      end

    DateTime.diff(now, link.last_synced_at) >= every * 60
  end

  defp ticking?, do: Application.get_env(:family, :calendar_sync_ticks, true)
end
