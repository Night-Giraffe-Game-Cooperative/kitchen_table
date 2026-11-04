defmodule FamilyWeb.LearnController do
  use FamilyWeb, :controller
  alias Family.Learn

  # Learn is an optional module: switched off, it isn't there.
  plug :switched_on

  def index(conn, _params) do
    user = conn.assigns.current_user
    json(conn, %{known: Learn.known_for(user), trips: Learn.trips(user)})
  end

  def mark(conn, %{"key" => key} = params) do
    with :ok <- Learn.mark(conn.assigns.current_user, key, params["known"] == true), do: json(conn, %{ok: true})
  end

  def trip(conn, %{"lang" => lang} = params) do
    with :ok <- Learn.set_trip(conn.assigns.current_user, lang, params["date"]), do: json(conn, %{ok: true})
  end

  defp switched_on(conn, _opts) do
    if Family.Modules.on?("learn"),
      do: conn,
      else: conn |> put_status(404) |> json(%{error: "Learn is switched off. An admin can switch it on on the Family page."}) |> halt()
  end
end
