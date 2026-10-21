defmodule FamilyWeb.RewardController do
  use FamilyWeb, :controller
  alias Family.Tasks

  def index(conn, _) do
    rewards = Tasks.rewards(conn.assigns.current_user)
    json(conn, %{rewards: Enum.map(rewards, &Present.rewards/1), stickers: Tasks.stickers()})
  end

  def pay(conn, %{"user_id" => user_id, "pence" => pence}) do
    case Integer.parse(user_id) do
      {id, ""} -> with {:ok, _} <- Tasks.pay(conn.assigns.current_user, id, pence), do: json(conn, %{ok: true})
      _ -> {:error, :not_found}
    end
  end

  def unpay(conn, %{"id" => id}) do
    with :ok <- Tasks.unpay(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end

  def create_goal(conn, params) do
    with {:ok, goal} <- Tasks.create_goal(conn.assigns.current_user, params), do: json(conn, %{goal: Present.goal(goal)})
  end

  def update_goal(conn, %{"id" => id} = params) do
    with {:ok, goal} <- Tasks.update_goal(conn.assigns.current_user, String.to_integer(id), params), do: json(conn, %{goal: Present.goal(goal)})
  end

  def delete_goal(conn, %{"id" => id}) do
    with :ok <- Tasks.delete_goal(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end
end
