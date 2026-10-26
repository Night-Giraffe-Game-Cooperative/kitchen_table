defmodule Family.KidCodesTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.{Accounts, Mailer}
  alias Family.Accounts.User
  alias FamilyWeb.Present

  defp app, do: build_conn() |> put_req_header("x-family", "1")

  test "a kid without an email signs in with a code a grown-up makes" do
    admin = admin_fixture()
    jo = person_fixture(admin, "grownup", "Jo")
    # From another family, so not one of Sam's guardians.
    kim = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The Parkers"})

    {:ok, sam, code} = Accounts.invite(admin, %{"name" => "Sam", "email" => "", "role" => "kid"})
    assert User.no_email?(sam)
    assert %{email: nil, no_email: true} = Present.person_admin(sam)
    # There's nobody to email, so nothing waits in the outbox for Sam.
    refute Enum.any?(Mailer.outbox(), &(&1.to == sam.email))

    assert app() |> post("/api/session/code", %{"code" => "otter-maple-drum-42"}) |> json_response(401)
    # Spaces and capitals, the way a kid might type it.
    typed = code |> String.replace("-", " ") |> String.upcase()
    signed = app() |> post("/api/session/code", %{"code" => typed})
    assert %{"me" => %{"name" => "Sam", "must_change_password" => false, "no_email" => true}} = json_response(signed, 200)
    assert %{"me" => %{"name" => "Sam"}} = signed |> recycle() |> put_req_header("x-family", "1") |> get("/api/me") |> json_response(200)
    # It works once.
    assert app() |> post("/api/session/code", %{"code" => code}) |> json_response(401)

    # Sam's guardian makes a new one; a grown-up who doesn't look after Sam can't.
    sam = Accounts.get_user(sam.id)
    assert {:error, :forbidden} = Accounts.reset_password(kim, sam)
    {:ok, _, again} = Accounts.reset_password(jo, sam)
    refute again == code
    assert app() |> post("/api/session/code", %{"code" => again}) |> json_response(200)

    # Saving Sam's details with the email empty keeps it that way; a grown-up needs one.
    sam = Accounts.get_user(sam.id)
    {:ok, sammy} = Accounts.admin_update(admin, sam, %{"name" => "Sammy", "email" => ""})
    assert sammy.email == sam.email
    assert {:error, %Ecto.Changeset{}} = Accounts.admin_update(admin, sammy, %{"role" => "grownup"})
    assert {:error, %Ecto.Changeset{}} = Accounts.invite(admin, %{"name" => "Pat", "email" => "", "role" => "grownup"})

    # A kid with an email of their own still signs in with it, not a code.
    {:ok, _, mia_code} = Accounts.invite(admin, %{"name" => "Mia", "email" => "mia@example.com", "role" => "kid"})
    assert app() |> post("/api/session/code", %{"code" => mia_code}) |> json_response(401)
  end
end
