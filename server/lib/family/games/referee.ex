defmodule Family.Games.Referee do
  @moduledoc """
  Runs every change to a game one at a time, so two people moving at once
  can't overwrite each other: the second finds the version has moved on.
  """
  use GenServer

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  def run(fun), do: GenServer.call(__MODULE__, {:run, fun}, 15_000)

  @impl true
  def init(_), do: {:ok, nil}

  @impl true
  def handle_call({:run, fun}, _from, state) do
    reply =
      try do
        fun.()
      rescue
        e -> {:error, {:crashed, Exception.message(e)}}
      end

    {:reply, reply, state}
  end
end
