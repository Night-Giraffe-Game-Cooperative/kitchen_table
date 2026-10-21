defmodule FamilyWeb.Auth do
  @moduledoc """
  Sign-in by an HttpOnly cookie holding a random session token. Changes must
  also carry an `x-family` header, which another website can't add, so a page
  elsewhere can't act as someone here.
  """

  import Plug.Conn
  alias Family.Accounts

  @cookie "family_session"
  @max_age 120 * 86_400

  def init(step), do: step

  def call(conn, :load) do
    conn = fetch_cookies(conn)
    token = conn.req_cookies[@cookie]
    user = token && Accounts.user_for_session(token)

    conn
    |> assign(:current_user, user)
    |> assign(:session_token, token)
    |> check_header()
  end

  def call(%{assigns: %{current_user: nil}} = conn, :require), do: deny(conn, 401, "signed_out")
  def call(conn, :require), do: conn

  def call(%{assigns: %{current_user: %{must_change_password: true}}} = conn, :password_chosen),
    do: deny(conn, 403, "must_change_password")

  def call(conn, :password_chosen), do: conn

  defp check_header(%{method: method} = conn) when method in ~w(GET HEAD OPTIONS), do: conn

  defp check_header(conn) do
    if get_req_header(conn, "x-family") == ["1"], do: conn, else: deny(conn, 403, "missing_header")
  end

  defp deny(conn, status, error) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, Jason.encode!(%{error: error}))
    |> halt()
  end

  def sign_in(conn, user) do
    token = Accounts.create_session(user)

    put_resp_cookie(conn, @cookie, token,
      http_only: true,
      same_site: "Lax",
      secure: conn.scheme == :https,
      max_age: @max_age
    )
  end

  def sign_out(conn) do
    Accounts.delete_session(conn.assigns[:session_token])
    delete_resp_cookie(conn, @cookie, http_only: true, same_site: "Lax")
  end

  def socket_token(user), do: Phoenix.Token.sign(FamilyWeb.Endpoint, "user socket", user.id)
end
