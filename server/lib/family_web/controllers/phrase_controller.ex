defmodule FamilyWeb.PhraseController do
  use FamilyWeb, :controller
  alias Family.Phrases

  def index(conn, _params) do
    user = conn.assigns.current_user
    json(conn, %{known: Phrases.known_for(user), trips: Phrases.trips(user)})
  end

  def mark(conn, %{"key" => key} = params) do
    with :ok <- Phrases.mark(conn.assigns.current_user, key, params["known"] == true), do: json(conn, %{ok: true})
  end

  def trip(conn, %{"lang" => lang} = params) do
    with :ok <- Phrases.set_trip(conn.assigns.current_user, lang, params["date"]), do: json(conn, %{ok: true})
  end
end
