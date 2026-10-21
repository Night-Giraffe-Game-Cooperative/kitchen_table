defmodule Family.Zip do
  @moduledoc """
  Writes a zip file one entry at a time, straight to disk, so a family's
  years of photos never have to fit in memory. Text is squeezed (deflate);
  files from disk, photos already squeezed, go in as they are. Archives and
  entries past 4 GB use the zip64 extensions, which every modern unzipper
  reads. (OTP's own `:zip` can't mix entries from memory with files on disk
  under other names.)
  """

  import Bitwise

  @limit 0xFFFFFFFF
  @chunk 1_048_576

  @doc """
  Writes `entries` to `path`. Each is `{name, {:data, binary}}` or `{name,
  {:file, path_on_disk}}`. `:zip64_over` lowers the size at which zip64
  starts, for tests.
  """
  def create(path, entries, opts \\ []) do
    limit = Keyword.get(opts, :zip64_over, @limit)
    {:ok, out} = :file.open(path, [:write, :binary, :raw, {:delayed_write, @chunk, 2000}])

    try do
      {offset, central} =
        Enum.reduce(entries, {0, []}, fn {name, source}, {offset, central} ->
          {written, record} = entry(out, offset, name, source, limit)
          {offset + written, [record | central]}
        end)

      directory = central |> Enum.reverse() |> IO.iodata_to_binary()
      :ok = :file.write(out, directory)
      :ok = :file.write(out, ending(length(entries), byte_size(directory), offset, limit))
      :ok
    after
      :file.close(out)
    end
  end

  defp entry(out, offset, name, source, limit) do
    {method, crc, size, packed, write} =
      case source do
        {:data, data} ->
          deflated = deflate(data)
          {8, :erlang.crc32(data), byte_size(data), byte_size(deflated), fn -> :file.write(out, deflated) end}

        {:file, file} ->
          {crc, size} = scan(file)
          {0, crc, size, size, fn -> copy(file, out) end}
      end

    {time, date} = dos_time(NaiveDateTime.utc_now())
    big = size >= limit or packed >= limit
    local_extra = if big, do: <<1::little-16, 16::little-16, size::little-64, packed::little-64>>, else: <<>>
    version = if big or offset >= limit, do: 45, else: 20
    # Bit 11: the name is UTF-8.
    common = <<version::little-16, 0x0800::little-16, method::little-16, time::little-16, date::little-16, crc::little-32>>
    sizes = if big, do: <<@limit::little-32, @limit::little-32>>, else: <<packed::little-32, size::little-32>>

    local = [<<0x04034B50::little-32>>, common, sizes, <<byte_size(name)::little-16, byte_size(local_extra)::little-16>>, name, local_extra]
    :ok = :file.write(out, local)
    :ok = write.()

    # The central record's zip64 fields come in this order, each only if needed.
    far = offset >= limit
    central_extra = (if big, do: <<size::little-64, packed::little-64>>, else: <<>>) <> if(far, do: <<offset::little-64>>, else: <<>>)
    central_extra = if central_extra == <<>>, do: <<>>, else: <<1::little-16, byte_size(central_extra)::little-16>> <> central_extra

    record = [
      <<0x02014B50::little-32, 45::little-16>>,
      common,
      sizes,
      <<byte_size(name)::little-16, byte_size(central_extra)::little-16, 0::little-16, 0::little-16, 0::little-16, 0::little-32>>,
      <<if(far, do: @limit, else: offset)::little-32>>,
      name,
      central_extra
    ]

    {IO.iodata_length(local) + packed, record}
  end

  defp ending(count, directory_size, directory_offset, limit) do
    if count >= 0xFFFF or directory_size >= limit or directory_offset >= limit do
      zip64_end_at = directory_offset + directory_size

      <<0x06064B50::little-32, 44::little-64, 45::little-16, 45::little-16, 0::little-32, 0::little-32, count::little-64, count::little-64,
        directory_size::little-64, directory_offset::little-64, 0x07064B50::little-32, 0::little-32, zip64_end_at::little-64,
        1::little-32, 0x06054B50::little-32, 0::little-16, 0::little-16, 0xFFFF::little-16, 0xFFFF::little-16, @limit::little-32,
        @limit::little-32, 0::little-16>>
    else
      <<0x06054B50::little-32, 0::little-16, 0::little-16, count::little-16, count::little-16, directory_size::little-32,
        directory_offset::little-32, 0::little-16>>
    end
  end

  defp deflate(data) do
    z = :zlib.open()
    :ok = :zlib.deflateInit(z, :default, :deflated, -15, 8, :default)
    packed = :zlib.deflate(z, data, :finish)
    :zlib.deflateEnd(z)
    :zlib.close(z)
    IO.iodata_to_binary(packed)
  end

  defp scan(file) do
    {:ok, io} = :file.open(file, [:read, :binary, :raw, {:read_ahead, @chunk}])

    try do
      scan(io, 0, 0)
    after
      :file.close(io)
    end
  end

  defp scan(io, crc, size) do
    case :file.read(io, @chunk) do
      {:ok, data} -> scan(io, :erlang.crc32(crc, data), size + byte_size(data))
      :eof -> {crc, size}
    end
  end

  defp copy(file, out) do
    {:ok, io} = :file.open(file, [:read, :binary, :raw, {:read_ahead, @chunk}])

    try do
      Stream.repeatedly(fn -> :file.read(io, @chunk) end)
      |> Enum.reduce_while(:ok, fn
        {:ok, data}, :ok -> {:cont, :file.write(out, data)}
        :eof, :ok -> {:halt, :ok}
      end)
    after
      :file.close(io)
    end
  end

  defp dos_time(%NaiveDateTime{} = t) do
    {(t.hour <<< 11) ||| (t.minute <<< 5) ||| div(t.second, 2), ((t.year - 1980) <<< 9) ||| (t.month <<< 5) ||| t.day}
  end
end
