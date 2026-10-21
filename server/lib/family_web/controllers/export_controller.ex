defmodule FamilyWeb.ExportController do
  use FamilyWeb, :controller
  alias Family.{Export, Permissions}

  def me(conn, _) do
    with {:ok, path, filename} <- Export.person(conn.assigns.current_user), do: send_zip(conn, path, filename)
  end

  def family(conn, _) do
    if Permissions.can?(conn.assigns.current_user, :manage_people) do
      with {:ok, path, filename} <- Export.family(), do: send_zip(conn, path, filename)
    else
      {:error, :forbidden}
    end
  end

  defp send_zip(conn, path, filename) do
    conn = send_download(conn, {:file, path}, filename: filename, content_type: "application/zip")
    File.rm(path)
    conn
  end
end
