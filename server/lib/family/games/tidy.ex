defmodule Family.Games.Tidy do
  @moduledoc "Finishes games left untouched for two days, checking once an hour."

  use GenServer
  require Logger

  @tick :timer.hours(1)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    if ticking?(), do: Process.send_after(self(), :tick, :timer.seconds(30))
    {:ok, nil}
  end

  @impl true
  def handle_info(:tick, state) do
    try do
      case Family.Games.finish_idle() do
        0 -> :ok
        n -> Logger.info("Put away #{n} game(s) with no moves for two days")
      end
    rescue
      e -> Logger.error("Putting away quiet games failed: " <> Exception.message(e))
    end

    Process.send_after(self(), :tick, @tick)
    {:noreply, state}
  end

  defp ticking?, do: Application.get_env(:family, :game_tidy_ticks, true)
end
