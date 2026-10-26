defmodule FamilyWeb.SessionController do
  use FamilyWeb, :controller
  alias Family.{Accounts, RateLimit, SetupCode}
  alias FamilyWeb.Auth

  def setup_status(conn, _) do
    needed = Accounts.setup_needed?()
    # Asking makes the code (and logs it), so it's ready by the time the form is.
    code = needed and SetupCode.current() != nil
    json(conn, %{needed: needed, code: code, app_name: app_name()})
  end

  def setup(conn, params) do
    with :ok <- RateLimit.hit({:setup, ip(conn)}, 10, :timer.minutes(10)),
         :ok <- if(SetupCode.valid?(params["setup_code"]), do: :ok, else: {:error, :setup_code}),
         {:ok, user} <- Accounts.create_first_admin(Map.take(params, ~w(name email password colour avatar))) do
      SetupCode.used()
      conn |> Auth.sign_in(user) |> json(%{me: Present.me(user)})
    else
      {:error, :rate_limited} ->
        conn |> put_status(429) |> json(%{error: "Too many tries. Wait ten minutes and try again."})

      {:error, :setup_code} ->
        conn |> put_status(403) |> json(%{error: "That setup code isn't right."})

      error ->
        error
    end
  end

  def create(conn, %{"email" => email, "password" => password}) do
    ip = ip(conn)
    key = String.downcase(String.trim(to_string(email)))

    with :ok <- RateLimit.hit({:email, key}, 8, :timer.minutes(10)),
         :ok <- RateLimit.hit({:ip, ip}, 40, :timer.minutes(10)) do
      case Accounts.authenticate(email, password) do
        {:ok, user} ->
          RateLimit.reset({:email, key})
          Accounts.mark_seen(user)
          conn |> Auth.sign_in(user) |> json(%{me: Present.me(user)})

        {:error, :invalid} ->
          conn |> put_status(401) |> json(%{error: "That email and password don't match."})

        {:error, :inactive} ->
          conn |> put_status(403) |> json(%{error: "This account is switched off. Ask an admin."})

        {:error, :otp_expired} ->
          conn
          |> put_status(401)
          |> json(%{error: "That one-time password has expired. Ask an admin for a new one."})
      end
    else
      {:error, :rate_limited} ->
        conn |> put_status(429) |> json(%{error: "Too many tries. Wait ten minutes and try again."})
    end
  end

  def create(conn, _), do: conn |> put_status(422) |> json(%{error: "Enter your email and password."})

  @doc "A kid without an email signs in with the code a grown-up made for them."
  def code(conn, params) do
    with :ok <- RateLimit.hit({:code, ip(conn)}, 10, :timer.minutes(10)) do
      case Accounts.authenticate_code(params["code"]) do
        {:ok, user} ->
          Accounts.mark_seen(user)
          conn |> Auth.sign_in(user) |> json(%{me: Present.me(user)})

        {:error, _} ->
          conn |> put_status(401) |> json(%{error: "That code isn't right, or it has run out. Ask a grown-up for a new one."})
      end
    else
      {:error, :rate_limited} ->
        conn |> put_status(429) |> json(%{error: "Too many tries. Wait ten minutes and try again."})
    end
  end

  def delete(conn, _), do: conn |> Auth.sign_out() |> json(%{ok: true})

  defp app_name, do: Application.get_env(:family, :app_name)
  defp ip(conn), do: conn.remote_ip |> :inet.ntoa() |> to_string()
end
