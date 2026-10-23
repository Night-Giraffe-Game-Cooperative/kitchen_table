defmodule FamilyWeb.TaskController do
  use FamilyWeb, :controller
  alias Family.Tasks

  def index(conn, %{"from" => from, "to" => to}) do
    user = conn.assigns.current_user

    with {:ok, from} <- Date.from_iso8601(from),
         {:ok, to} <- Date.from_iso8601(to),
         true <- Date.diff(to, from) in 0..62 || {:error, "Ask for up to two months of days."} do
      {tasks, done} = Tasks.list(user, from, to)
      json(conn, %{
        tasks: Enum.map(tasks, &Present.task/1),
        done: Enum.map(done, &Present.completion/1),
        to_check: Enum.map(Tasks.to_check(user), &Present.to_check/1)
      })
    else
      {:error, message} when is_binary(message) -> {:error, message}
      _ -> {:error, "Those days aren't right."}
    end
  end

  def create(conn, params) do
    with {:ok, task} <- Tasks.create(conn.assigns.current_user, params), do: json(conn, %{task: Present.task(task)})
  end

  def update(conn, %{"id" => id} = params) do
    with {:ok, task} <- Tasks.update(conn.assigns.current_user, String.to_integer(id), params), do: json(conn, %{task: Present.task(task)})
  end

  def delete(conn, %{"id" => id}) do
    with :ok <- Tasks.delete(conn.assigns.current_user, String.to_integer(id)), do: json(conn, %{ok: true})
  end

  def done(conn, %{"id" => id, "user_id" => person, "on" => on} = params) when is_integer(person) do
    user = conn.assigns.current_user

    with {:ok, on} <- day(on, if(user.role == "kid", do: 7, else: 31)),
         :ok <- Tasks.tick(user, String.to_integer(id), person, on, params["done"] != false),
         do: json(conn, %{ok: true})
  end

  def check(conn, %{"id" => id, "user_id" => person, "on" => on, "ok" => ok}) when is_integer(person) and is_boolean(ok) do
    with {:ok, on} <- day(on, 31),
         :ok <- Tasks.check(conn.assigns.current_user, String.to_integer(id), person, on, ok),
         do: json(conn, %{ok: true})
  end

  def status(conn, %{"id" => id, "status" => status, "on" => on}) do
    with {:ok, on} <- day(on, 1),
         {:ok, task} <- Tasks.set_status(conn.assigns.current_user, String.to_integer(id), status, on),
         do: json(conn, %{task: Present.task(task)})
  end

  # The phone says which day it is, as it knows the family's day best. It's
  # kept near today, so ticks can't pile up stars on days long gone (a week
  # back for kids, a month for grown-ups catching up; homework is handed in
  # today).
  defp day(text, back) do
    case Date.from_iso8601(to_string(text)) do
      {:ok, on} ->
        case Date.diff(on, Tasks.today()) do
          ahead when ahead > 1 -> {:error, "That day hasn't come yet."}
          ago when ago < -back -> {:error, "That's too long ago to change now."}
          _ -> {:ok, on}
        end

      _ ->
        {:error, "That day isn't right."}
    end
  end
end
