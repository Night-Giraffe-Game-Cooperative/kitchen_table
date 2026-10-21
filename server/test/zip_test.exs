defmodule Family.ZipTest do
  use ExUnit.Case, async: true

  setup do
    dir = Path.join(System.tmp_dir!(), "zip-test-#{System.unique_integer([:positive])}")
    File.mkdir_p!(dir)
    on_exit(fn -> File.rm_rf!(dir) end)
    photo = Path.join(dir, "photo.jpg")
    File.write!(photo, :crypto.strong_rand_bytes(300_000))
    %{dir: dir, photo: photo}
  end

  defp entries(photo) do
    [
      {"me.json", {:data, String.duplicate(~s({"name":"Lucy","note":"café ☕"}\n), 500)}},
      {"chats/001-whole-family.json", {:data, "[]"}},
      {"media/ab/photo.jpg", {:file, photo}}
    ]
  end

  defp check(zip, photo) do
    {:ok, files} = :zip.unzip(String.to_charlist(zip), [:memory])
    files = Map.new(files, fn {name, data} -> {to_string(name), data} end)
    assert files["media/ab/photo.jpg"] == File.read!(photo)
    assert files["me.json"] =~ "café ☕"
    assert files["chats/001-whole-family.json"] == "[]"

    # And Python's zipfile, an unzipper of quite another kind, agrees.
    {out, 0} = System.cmd("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))", zip])
    assert out == "None\n3\n"
  end

  test "text is squeezed, files go in as they are, and unzippers read it back", %{dir: dir, photo: photo} do
    zip = Path.join(dir, "out.zip")
    assert :ok = Family.Zip.create(zip, entries(photo))
    check(zip, photo)
    assert File.stat!(zip).size < 300_000 + 5_000
  end

  test "past 4 GB it switches to zip64, which unzippers still read", %{dir: dir, photo: photo} do
    zip = Path.join(dir, "big.zip")
    # Pretend the limit is tiny so the zip64 records are written and read.
    assert :ok = Family.Zip.create(zip, entries(photo), zip64_over: 1_000)
    {out, 0} = System.cmd("python3", ["-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print([i.file_size for i in z.infolist()])", zip])
    assert out =~ "None\n"
    assert out =~ "300000"
    {out, 0} = System.cmd("unzip", ["-tq", zip])
    assert out =~ "No errors"
  end
end
