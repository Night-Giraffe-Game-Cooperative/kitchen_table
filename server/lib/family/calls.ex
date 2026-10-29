defmodule Family.Calls do
  @moduledoc """
  Video calls happening now. The pictures and sound go straight between the
  devices in a call; this keeps track of who is in each one, rings the rest of
  the chat when a call starts, notes the call in the chat, and holds the state
  of any game being played in the call, and the drawings on people's
  pictures, so late joiners see them too. It also holds the rules a grown-up
  has set in the call: which kids are muted, and whose pens are away.

  Calls live only in memory. When the last device leaves, the call waits a few
  seconds (a page reload shouldn't end it) and then ends.
  """

  use GenServer
  alias Family.Chat

  def start_link(_), do: GenServer.start_link(__MODULE__, :ok, name: __MODULE__)

  @doc "A device joins the call in a room, starting one if there isn't one."
  def join(room_id, peer, user_id), do: GenServer.call(__MODULE__, {:join, room_id, peer, user_id, self()})

  def leave(room_id, peer), do: GenServer.cast(__MODULE__, {:leave, room_id, peer})

  @doc "The calls going on in these rooms: %{room_id => %{user_ids, started_at}}."
  def live(room_ids), do: GenServer.call(__MODULE__, {:live, room_ids})

  @doc "The game being played in a room's call, or nil."
  def game(room_id), do: GenServer.call(__MODULE__, {:game, room_id})

  def put_game(room_id, game), do: GenServer.call(__MODULE__, {:put_game, room_id, game})

  @max_strokes 400

  @doc "The finished drawings on people's pictures in a room's call, oldest first."
  def ink(room_id), do: GenServer.call(__MODULE__, {:ink, room_id})

  @doc "Keeps a finished drawing (replacing an earlier copy of it). The oldest go past #{@max_strokes}."
  def put_stroke(room_id, stroke), do: GenServer.call(__MODULE__, {:put_stroke, room_id, stroke})

  def remove_stroke(room_id, id), do: GenServer.call(__MODULE__, {:remove_stroke, room_id, id})

  def wipe_ink(room_id), do: GenServer.call(__MODULE__, {:wipe_ink, room_id})

  @doc """
  The rules a grown-up has set in a room's call: who is muted, and whose pens
  are away, each as %{user_id => the grown-up who did it}. They last as long
  as the call, so leaving and coming back doesn't clear them.
  """
  def rules(room_id), do: GenServer.call(__MODULE__, {:rules, room_id})

  @doc """
  Mutes these people, or puts their pens away (rule :muted or :no_pens), or
  with on false lets them again. Only people who have been in the call count.
  Returns {:ok, the rules now}.
  """
  def put_rule(room_id, rule, user_ids, on, by) when rule in [:muted, :no_pens] and is_boolean(on),
    do: GenServer.call(__MODULE__, {:put_rule, room_id, rule, user_ids, on, by})

  @impl true
  def init(:ok), do: {:ok, %{calls: %{}, monitors: %{}}}

  @impl true
  def handle_call({:join, room_id, peer, user_id, pid}, _from, state) do
    ref = Process.monitor(pid)
    state = put_in(state.monitors[ref], {room_id, peer})

    {call, started?} =
      case state.calls[room_id] do
        nil -> {start_call(room_id, user_id), true}
        call -> {%{call | ending: nil}, false}
      end

    call = %{call | peers: Map.put(call.peers, peer, {user_id, ref}), everyone: MapSet.put(call.everyone, user_id)}
    state = put_in(state.calls[room_id], call)
    announce(room_id, call)
    {:reply, {:ok, %{started: started?, started_at: call.started_at}}, state}
  end

  def handle_call({:live, room_ids}, _from, state) do
    live =
      for id <- room_ids, call = state.calls[id], map_size(call.peers) > 0, into: %{} do
        {id, summary(call)}
      end

    {:reply, live, state}
  end

  def handle_call({:game, room_id}, _from, state) do
    {:reply, get_in(state.calls, [room_id, :game]), state}
  end

  def handle_call({:put_game, room_id, game}, _from, state) do
    update_call(state, room_id, &%{&1 | game: game})
  end

  def handle_call({:ink, room_id}, _from, state) do
    {:reply, get_in(state.calls, [room_id, :ink]) || [], state}
  end

  def handle_call({:put_stroke, room_id, stroke}, _from, state) do
    update_call(state, room_id, fn call ->
      ink = Enum.reject(call.ink, &(&1["id"] == stroke["id"])) ++ [stroke]
      %{call | ink: Enum.take(ink, -@max_strokes)}
    end)
  end

  def handle_call({:remove_stroke, room_id, id}, _from, state) do
    update_call(state, room_id, fn call -> %{call | ink: Enum.reject(call.ink, &(&1["id"] == id))} end)
  end

  def handle_call({:wipe_ink, room_id}, _from, state) do
    update_call(state, room_id, &%{&1 | ink: []})
  end

  def handle_call({:rules, room_id}, _from, state) do
    {:reply, get_in(state.calls, [room_id, :rules]) || no_rules(), state}
  end

  def handle_call({:put_rule, room_id, rule, user_ids, on, by}, _from, state) do
    case state.calls[room_id] do
      nil ->
        {:reply, {:error, :no_call}, state}

      call ->
        ids = Enum.filter(user_ids, &MapSet.member?(call.everyone, &1))
        set = call.rules[rule]
        set = if on, do: Enum.reduce(ids, set, &Map.put_new(&2, &1, by)), else: Map.drop(set, ids)
        rules = Map.put(call.rules, rule, set)
        {:reply, {:ok, rules}, put_in(state.calls[room_id], %{call | rules: rules})}
    end
  end

  defp update_call(state, room_id, fun) do
    case state.calls[room_id] do
      nil -> {:reply, {:error, :no_call}, state}
      call -> {:reply, :ok, put_in(state.calls[room_id], fun.(call))}
    end
  end

  @impl true
  def handle_cast({:leave, room_id, peer}, state), do: {:noreply, remove_peer(state, room_id, peer)}

  @impl true
  def handle_info({:DOWN, ref, :process, _, _}, state) do
    case Map.pop(state.monitors, ref) do
      {{room_id, peer}, monitors} -> {:noreply, remove_peer(%{state | monitors: monitors}, room_id, peer)}
      {nil, _} -> {:noreply, state}
    end
  end

  def handle_info({:end_call, room_id, token}, state) do
    case state.calls[room_id] do
      %{ending: ^token, peers: peers} = call when map_size(peers) == 0 ->
        end_call(room_id, call)
        {:noreply, %{state | calls: Map.delete(state.calls, room_id)}}

      _ ->
        {:noreply, state}
    end
  end

  defp remove_peer(state, room_id, peer) do
    case state.calls[room_id] do
      %{peers: %{^peer => {_user, ref}}} = call ->
        Process.demonitor(ref, [:flush])
        # Drawings on someone's picture go when they do.
        ink = Enum.reject(call.ink, &(&1["on"] == peer))
        call = %{call | peers: Map.delete(call.peers, peer), ink: ink}
        state = %{state | monitors: Map.delete(state.monitors, ref)}

        call =
          if map_size(call.peers) == 0 do
            token = make_ref()
            Process.send_after(self(), {:end_call, room_id, token}, Application.get_env(:family, :call_grace_ms, 8_000))
            %{call | ending: token}
          else
            call
          end

        announce(room_id, call)
        put_in(state.calls[room_id], call)

      _ ->
        state
    end
  end

  defp start_call(room_id, user_id) do
    started_at = DateTime.utc_now() |> DateTime.truncate(:second)

    {:ok, message} =
      Chat.post_system(room_id, %{kind: "call", user_id: user_id, data: %{"live" => true}})

    others = for member <- Chat.member_ids(room_id), member != user_id, do: member
    Enum.each(others, &Chat.notify_user(&1, "call_ring", %{room_id: room_id, by: user_id}))
    Family.Push.call_started(room_id, user_id, others)

    %{
      message_id: message.id,
      started_at: started_at,
      started_by: user_id,
      peers: %{},
      everyone: MapSet.new(),
      rung: others,
      game: nil,
      ink: [],
      rules: no_rules(),
      ending: nil
    }
  end

  defp no_rules, do: %{muted: %{}, no_pens: %{}}

  defp end_call(room_id, call) do
    seconds = DateTime.diff(DateTime.utc_now(), call.started_at)

    Chat.update_message_data(call.message_id, %{
      "live" => false,
      "seconds" => seconds,
      "people" => MapSet.to_list(call.everyone)
    })

    case Enum.reject(call.rung, &MapSet.member?(call.everyone, &1)) do
      [] -> :ok
      missed -> Family.Push.call_missed(room_id, call.started_by, missed)
    end

    Chat.notify_readers(room_id, "call_changed", %{room_id: room_id, call: nil})
  end

  defp announce(room_id, call) do
    Chat.notify_readers(room_id, "call_changed", %{room_id: room_id, call: summary(call)})
  end

  defp summary(call) do
    user_ids = call.peers |> Map.values() |> Enum.map(&elem(&1, 0)) |> Enum.uniq()
    %{user_ids: user_ids, started_at: call.started_at, started_by: call.started_by, message_id: call.message_id}
  end
end
