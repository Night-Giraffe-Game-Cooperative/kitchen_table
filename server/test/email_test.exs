defmodule Family.EmailTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.{Accounts, Mailer, Settings}

  setup do
    Process.register(self(), :fake_smtp)
    admin = admin_fixture()
    jo = person_fixture(admin, "grownup", "Jo")
    %{admin: admin, jo: jo}
  end

  test "an admin sets up Gmail; a test email goes first, then invitations are sent for real", %{conn: conn, admin: admin} do
    alex = sign_in(conn, admin.email, "a good password")
    jo = sign_in(build_conn() |> put_req_header("x-family", "1"), "jo@example.com", "Jo password")

    assert %{"email" => %{"on" => false}} = alex |> get("/api/email") |> json_response(200)
    assert jo |> get("/api/email") |> json_response(403)
    assert jo |> put("/api/email", %{"address" => "us@gmail.com", "password" => "abcd efgh ijkl mnop"}) |> json_response(403)

    # A wrong app password is turned away, and nothing is kept.
    assert %{"error" => "Gmail didn't accept" <> _} = alex |> put("/api/email", %{"address" => "us@gmail.com", "password" => "wrong"}) |> json_response(422)
    assert_receive {:email, _, _, _, _}
    assert Mailer.smtp() == :none

    assert %{"error" => "Put in the email server" <> _} = alex |> put("/api/email", %{"address" => "us@example.org", "password" => "pw"}) |> json_response(422)

    # Gmail needs only the address and app password; the spaces go.
    assert %{"email" => %{"on" => true, "source" => "app", "address" => "us@gmail.com", "host" => "smtp.gmail.com", "port" => 587, "from" => "Kitchen Table <us@gmail.com>"} = status} =
             alex |> put("/api/email", %{"address" => " us@gmail.com", "password" => "abcd efgh ijkl mnop"}) |> json_response(200)

    refute Map.has_key?(status, "password")
    assert_receive {:email, opts, to, "Kitchen Table can send email", _}
    assert opts[:password] == "abcdefghijklmnop" and to == admin.email
    refute Settings.get("smtp_password") =~ "abcdefghijklmnop"

    # Now an invitation goes by email as well as into the outbox.
    {:ok, _, otp} = Accounts.invite(admin, %{"name" => "Robin", "email" => "robin@example.com", "role" => "grownup"})
    assert_receive {:email, [host: "smtp.gmail.com", port: 587, username: "us@gmail.com", password: "abcdefghijklmnop", from: "Kitchen Table <us@gmail.com>"], "robin@example.com", _, body}
    assert body =~ otp
    assert [%{to: "robin@example.com"} | _] = Mailer.outbox()

    # Another provider needs its server; turning it off keeps email in the outbox again.
    assert %{"email" => %{"host" => "smtp.example.org", "port" => 465}} =
             alex |> put("/api/email", %{"address" => "us@example.org", "password" => "pw", "host" => "smtp.example.org", "port" => "465"}) |> json_response(200)

    assert %{"email" => %{"on" => false}} = alex |> delete("/api/email") |> json_response(200)
    {:ok, _, _} = Accounts.invite(admin, %{"name" => "Gran", "email" => "gran@example.com", "role" => "grownup"})
    refute_receive {:email, _, "gran@example.com", _, _}, 100
  end
end
