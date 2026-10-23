defmodule FamilyWeb.MeController do
  use FamilyWeb, :controller
  alias Family.Accounts
  alias FamilyWeb.Auth

  def show(conn, _) do
    user = conn.assigns.current_user
    Accounts.mark_seen(user)

    json(conn, %{
      me: Present.me(user),
      socket_token: Auth.socket_token(user),
      app_name: Application.get_env(:family, :app_name),
      reactions: Family.Chat.reaction_emoji(),
      colours: Family.Accounts.User.colours(),
      ice_servers: Application.get_env(:family, :ice_servers, []),
      https_port: Application.get_env(:family, :https_port)
    })
  end

  def update(conn, params) do
    with {:ok, user} <- Accounts.update_profile(conn.assigns.current_user, Map.take(params, ~w(name colour avatar morning evening))) do
      json(conn, %{me: Present.me(user)})
    end
  end

  def password(conn, %{"current" => current, "new" => new}) do
    with {:ok, user} <- Accounts.change_password(conn.assigns.current_user, current, new) do
      json(conn, %{me: Present.me(user)})
    end
  end

  def password(conn, _), do: conn |> put_status(422) |> json(%{error: "Enter both passwords."})

  def delete(conn, params) do
    with :ok <- Family.Erase.myself(conn.assigns.current_user, params["password"]) do
      conn |> Auth.sign_out() |> json(%{ok: true})
    end
  end
end
