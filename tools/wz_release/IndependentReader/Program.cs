using System;
using System.Collections.Generic;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using MapleLib.WzLib;
using MapleLib.WzLib.WzProperties;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class Program
{
    private const string ReaderPin = "93099ab42c3225272432c3da8942024153a5ffab";
    private static readonly Dictionary<string, WzFile> Files = new Dictionary<string, WzFile>();
    private static readonly HashSet<string> Decoded = new HashSet<string>();
    private static readonly JArray Errors = new JArray();
    private static readonly JArray Canvases = new JArray();
    private static readonly JArray Sounds = new JArray();
    private static readonly JArray ParsedImages = new JArray();

    private static string Hash(Stream stream)
    {
        using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }

    private static WzObject Node(string path)
    {
        var parts = path.Split('/');
        string fileName = parts[0].EndsWith(".wz", StringComparison.OrdinalIgnoreCase) ? parts[0] : parts[0] + ".wz";
        WzObject current = Files[fileName].WzDirectory;
        for (int i = 1; i < parts.Length; i++)
        {
            current = current[parts[i]];
            if (current == null) throw new InvalidDataException("Missing node: " + path);
        }
        for (int i = 0; current is WzUOLProperty uol && i < 32; i++) current = uol.LinkValue;
        if (current == null || current is WzUOLProperty) throw new InvalidDataException("Unresolved alias: " + path);
        return current;
    }

    private static void Decode(string path, WzObject value)
    {
        if (!Decoded.Add(path)) return;
        if (value is WzCanvasProperty canvas)
        {
            // This is MapleLib's established decoder, not a Python re-parse or header-only check.
            using (var bitmap = canvas.GetLinkedWzCanvasBitmap())
            {
                if (bitmap == null || bitmap.Width <= 0 || bitmap.Height <= 0) throw new InvalidDataException("Empty decoded bitmap: " + path);
                using (var png = new MemoryStream())
                {
                    bitmap.Save(png, ImageFormat.Png);
                    png.Position = 0;
                    Canvases.Add(new JObject { ["path"] = path, ["width"] = bitmap.Width, ["height"] = bitmap.Height, ["decoded_png_sha256"] = Hash(png) });
                }
            }
        }
        else if (value is WzBinaryProperty sound)
        {
            byte[] bytes = sound.GetBytes(false);
            if (bytes == null || bytes.Length == 0) throw new InvalidDataException("Empty decoded sound bytes: " + path);
            using (var data = new MemoryStream(bytes)) Sounds.Add(new JObject { ["path"] = path, ["bytes"] = bytes.Length, ["sha256"] = Hash(data), ["duration_ms"] = sound.Length });
        }
    }

    private static void Walk(string path, WzObject node)
    {
        Decode(path, node);
        if (node is WzUOLProperty) return;
        IEnumerable<WzImageProperty> children = node is WzImage image ? image.WzProperties : (node as WzImageProperty)?.WzProperties;
        if (children == null) return;
        foreach (var child in children) Walk(path + "/" + child.Name, child);
    }

    private static void Attempt(string path, Action action)
    {
        try { action(); }
        catch (Exception error) { Errors.Add(new JObject { ["path"] = path, ["error"] = error.ToString() }); }
    }

    private static int Main(string[] args)
    {
        if (args.Length != 3) throw new ArgumentException("request.json isolated-download-dir report.json");
        var request = JObject.Parse(File.ReadAllText(args[0]));
        string directory = Path.GetFullPath(args[1]);
        Directory.CreateDirectory(directory);
        var fileResults = new JArray();
        using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) })
        {
            foreach (JObject spec in request["files"])
            {
                string name = (string)spec["name"];
                Attempt(name, () =>
                {
                    if (Path.GetFileName(name) != name) throw new InvalidDataException("Unsafe archive filename");
                    string target = Path.Combine(directory, name);
                    using (var response = http.GetAsync((string)spec["url"], HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
                    {
                        response.EnsureSuccessStatusCode();
                        using (var input = response.Content.ReadAsStreamAsync().GetAwaiter().GetResult())
                        using (var output = File.Create(target)) input.CopyTo(output);
                    }
                    string sha;
                    using (var input = File.OpenRead(target)) sha = Hash(input);
                    if (sha != (string)spec["sha256"] || new FileInfo(target).Length != (long)spec["size"]) throw new InvalidDataException("Download hash/size mismatch");
                    var wz = new WzFile(target, 83, WzMapleVersion.GMS);
                    var status = wz.ParseWzFile();
                    if (status != WzFileParseStatus.Success) throw new InvalidDataException("Established reader failed archive: " + status);
                    Files.Add(name, wz);
                    fileResults.Add(new JObject { ["name"] = name, ["sha256"] = sha, ["size"] = new FileInfo(target).Length, ["parse"] = status.ToString() });
                });
            }
        }
        foreach (JToken imagePath in request["decode_images"])
        {
            string path = (string)imagePath;
            Attempt(path, () =>
            {
                var image = Node(path) as WzImage;
                if (image == null || !image.ParseImage()) throw new InvalidDataException("Lazy IMG parse failed: " + path);
                Walk(path, image);
                ParsedImages.Add(path);
            });
        }
        foreach (JObject requirement in request["requirements"])
        {
            string path = (string)requirement["path"];
            Attempt(path, () =>
            {
                var node = Node(path);
                Decode(path, node);
                if (requirement["dimensions"] is JArray dimensions)
                {
                    var canvas = node as WzCanvasProperty;
                    if (canvas == null || canvas.PngProperty.Width != (int)dimensions[0] || canvas.PngProperty.Height != (int)dimensions[1]) throw new InvalidDataException("Canvas dimensions differ: " + path);
                }
                if ((string)requirement["type"] == "string" && string.IsNullOrWhiteSpace(node.GetString())) throw new InvalidDataException("Empty required string: " + path);
            });
        }
        var report = new JObject
        {
            ["reader"] = "lastbattle/MapleLib", ["reader_commit"] = ReaderPin,
            ["python_writer_executed_in_verifier"] = false,
            ["status"] = Errors.Count == 0 ? "pass" : "fail", ["files"] = fileResults,
            ["lazy_images_parsed"] = ParsedImages, ["canvases_decoded"] = Canvases,
            ["sounds_read"] = Sounds, ["requirements_count"] = request["requirements"].Count(), ["errors"] = Errors
        };
        File.WriteAllText(args[2], report.ToString(Formatting.Indented));
        foreach (var file in Files.Values) file.Dispose();
        Console.WriteLine("MapleLib independent validation: {0}, images {1}, decoded canvases {2}, errors {3}", (string)report["status"], ParsedImages.Count, Canvases.Count, Errors.Count);
        return Errors.Count == 0 ? 0 : 1;
    }
}
