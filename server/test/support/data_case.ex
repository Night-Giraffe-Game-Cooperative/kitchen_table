defmodule Family.DataCase do
  use ExUnit.CaseTemplate

  using do
    quote do
      alias Family.Repo
      import Family.DataCase
    end
  end

  setup tags do
    pid = Ecto.Adapters.SQL.Sandbox.start_owner!(Family.Repo, shared: not tags[:async])
    on_exit(fn -> Ecto.Adapters.SQL.Sandbox.stop_owner(pid) end)
    :ok
  end

  def admin_fixture(attrs \\ %{}) do
    {:ok, admin} =
      Family.Accounts.create_first_admin(
        Map.merge(%{"name" => "Alex", "email" => "alex@example.com", "password" => "a good password"}, attrs)
      )

    admin
  end

  @doc "Invites someone and has them choose a password, as they would on first sign-in."
  def person_fixture(admin, role, name \\ nil, attrs \\ %{}) do
    name = name || "#{role}#{System.unique_integer([:positive])}"
    email = "#{String.downcase(name)}@example.com"
    {:ok, user, otp} = Family.Accounts.invite(admin, Map.merge(%{"name" => name, "email" => email, "role" => role}, attrs))
    {:ok, user} = Family.Accounts.change_password(user, otp, "#{name} password")
    user
  end
end
