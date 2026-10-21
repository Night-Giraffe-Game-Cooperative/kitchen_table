defmodule Family.AccountsTest do
  use Family.DataCase, async: false
  alias Family.{Accounts, Permissions, Chat}

  test "the first admin sets the family up, once" do
    assert Accounts.setup_needed?()
    admin = admin_fixture()
    assert admin.role == "admin"
    refute Accounts.setup_needed?()
    assert Chat.family_room()

    assert {:error, :already_set_up} =
             Accounts.create_first_admin(%{"name" => "X", "email" => "x@example.com", "password" => "longenough"})
  end

  test "an invitation sends a one-time password that must be changed" do
    admin = admin_fixture()
    {:ok, kid, otp} = Accounts.invite(admin, %{"name" => "Mia", "email" => "Mia@Example.com ", "role" => "kid"})

    assert kid.email == "mia@example.com"
    assert kid.must_change_password
    assert otp =~ ~r/^[a-z]+-[a-z]+-[a-z]+-\d\d$/
    assert [%{to: "mia@example.com", body: body} | _] = Family.Mailer.outbox()
    assert body =~ otp

    assert {:ok, signed_in} = Accounts.authenticate("mia@example.com", otp)
    assert signed_in.must_change_password

    assert {:error, _} = Accounts.change_password(signed_in, otp, otp)
    assert {:error, "Use at least 8 characters."} = Accounts.change_password(signed_in, otp, "short")
    assert {:ok, changed} = Accounts.change_password(signed_in, otp, "unicorns forever")
    refute changed.must_change_password
    assert {:error, :invalid} = Accounts.authenticate("mia@example.com", otp)
    assert {:ok, _} = Accounts.authenticate("mia@example.com", "unicorns forever")
    assert Chat.member?(changed, Chat.family_room().id)
  end

  test "an expired one-time password no longer signs in" do
    admin = admin_fixture()
    {:ok, kid, otp} = Accounts.invite(admin, %{"name" => "Sam", "email" => "sam@example.com", "role" => "kid"})
    past = DateTime.utc_now() |> DateTime.add(-60) |> DateTime.truncate(:second)
    kid |> Ecto.Changeset.change(otp_expires_at: past) |> Repo.update!()
    assert {:error, :otp_expired} = Accounts.authenticate("sam@example.com", otp)
  end

  test "only admins invite, and the last admin can't be demoted" do
    admin = admin_fixture()
    grownup = person_fixture(admin, "grownup", "Jo")

    assert {:error, :forbidden} = Accounts.invite(grownup, %{"name" => "Z", "email" => "z@example.com", "role" => "kid"})
    assert {:error, :last_admin} = Accounts.admin_update(admin, admin, %{"role" => "grownup"})
    assert {:ok, _} = Accounts.admin_update(admin, grownup, %{"role" => "admin"})
    assert {:ok, demoted} = Accounts.admin_update(admin, admin, %{"role" => "grownup"})
    assert demoted.role == "grownup"
  end

  test "kids have fewer permissions, and grown-ups can change a kid's" do
    admin = admin_fixture()
    grownup = person_fixture(admin, "grownup", "Jo")
    kid = person_fixture(admin, "kid", "Mia")

    refute Permissions.can?(kid, :create_rooms)
    assert Permissions.can?(kid, :share_photos)
    assert Permissions.can?(admin, :manage_people)
    refute Permissions.can?(grownup, :manage_people)

    {:ok, kid} = Accounts.set_permissions(grownup, kid, %{"share_photos" => false, "nonsense" => true}, nil)
    refute Permissions.can?(kid, :share_photos)
    refute Map.has_key?(kid.permissions, "nonsense")

    # A grown-up can't change another grown-up's, and nobody can change an admin's.
    assert {:error, :forbidden} = Accounts.set_permissions(grownup, grownup, %{}, nil)
    assert {:error, :forbidden} = Accounts.set_permissions(admin, admin, %{}, nil)
    assert {:ok, _} = Accounts.set_permissions(admin, grownup, %{"manage_kids" => false}, nil)
  end

  test "quiet hours wrap round midnight" do
    user = %Family.Accounts.User{quiet_hours: %{"from" => "19:30", "to" => "07:00"}}
    assert Permissions.quiet_now?(user, {{2026, 10, 19}, {20, 0, 0}})
    assert Permissions.quiet_now?(user, {{2026, 10, 19}, {6, 59, 0}})
    refute Permissions.quiet_now?(user, {{2026, 10, 19}, {7, 0, 0}})
    refute Permissions.quiet_now?(user, {{2026, 10, 19}, {12, 0, 0}})
    refute Permissions.valid_quiet_hours?(%{"from" => "25:00", "to" => "07:00"})
  end

  test "switching someone off ends their sessions" do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Mia")
    token = Accounts.create_session(kid)
    assert Accounts.user_for_session(token).id == kid.id
    {:ok, _} = Accounts.admin_update(admin, kid, %{"active" => false})
    assert Accounts.user_for_session(token) == nil
    assert {:error, :inactive} = Accounts.authenticate(kid.email, "Mia password")
  end
end
