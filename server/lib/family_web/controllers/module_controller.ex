defmodule FamilyWeb.ModuleController do
  use FamilyWeb, :controller

  def update(conn, %{"name" => name} = params) do
    with :ok <- Family.Modules.switch(conn.assigns.current_user, name, params["on"]), do: json(conn, %{modules: Family.Modules.enabled()})
  end
end
