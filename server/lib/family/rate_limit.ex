defmodule Family.RateLimit do
  @moduledoc "Counts sign-in attempts per key in a time window, in memory."
  use GenServer

  @table __MODULE__

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    :ets.new(@table, [:named_table, :public, :set, write_concurrency: true])
    {:ok, nil}
  end

  @doc "Records an attempt and says whether it is allowed."
  def hit(key, limit, window_ms) do
    now = System.monotonic_time(:millisecond)

    case :ets.lookup(@table, key) do
      [{^key, count, started}] when now - started < window_ms ->
        :ets.insert(@table, {key, count + 1, started})
        if count + 1 <= limit, do: :ok, else: {:error, :rate_limited}

      _ ->
        :ets.insert(@table, {key, 1, now})
        :ok
    end
  end

  def reset(key), do: :ets.delete(@table, key)
end
