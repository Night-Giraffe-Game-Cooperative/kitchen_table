defmodule Family.Modules do
  @moduledoc """
  Optional parts of the app, which an admin switches on or off for everyone on
  the Family page. Each keeps to its own place: Learn is Family.Learn and
  FamilyWeb.LearnController here, and web/src/modules/learn in the web app. A
  new family starts with them all off.
  """
  alias Family.Settings
  alias Family.Accounts.User

  @all ~w(learn)

  @doc "The modules that are switched on, like [\"learn\"]."
  def enabled, do: Enum.filter(@all, &on?/1)

  def on?(name) when name in @all, do: Settings.get("module:" <> name) == "on"
  def on?(_name), do: false

  @doc "An admin switches a module on or off, and everyone's app catches up."
  def switch(%User{role: "admin"}, name, on) when name in @all and is_boolean(on) do
    Settings.put("module:" <> name, if(on, do: "on"))
    FamilyWeb.Endpoint.broadcast("family:presence", "modules_changed", %{modules: enabled()})
    :ok
  end

  def switch(%User{role: "admin"}, _name, _on), do: {:error, "That isn't one of the extras."}
  def switch(_user, _name, _on), do: {:error, "Only an admin can switch extras on or off."}
end
