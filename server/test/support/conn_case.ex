defmodule FamilyWeb.ConnCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      import Plug.Conn
      import Phoenix.ConnTest
      import Family.DataCase, only: [admin_fixture: 0, admin_fixture: 1, person_fixture: 2, person_fixture: 3, person_fixture: 4]
      import FamilyWeb.ConnCase
      @endpoint FamilyWeb.Endpoint
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Family.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    # Every test signs in from this machine, so each starts with a fresh count.
    Family.RateLimit.reset({:ip, "127.0.0.1"})
    {:ok, conn: Phoenix.ConnTest.build_conn() |> Plug.Conn.put_req_header("x-family", "1")}
  end

  import Phoenix.ConnTest
  @endpoint FamilyWeb.Endpoint

  @doc "Signs in through the real endpoint and keeps the cookie."
  def sign_in(conn, email, password) do
    conn = post(conn, "/api/session", %{"email" => email, "password" => password})
    200 = conn.status
    recycle(conn) |> Plug.Conn.put_req_header("x-family", "1")
  end
end
