// MapleTax Canada — tiny native desktop shell (~1MB).
// WinForms + WebView2 (uses the Edge engine built into Windows).
// Serves the embedded web app at https://mapletax.local/ (proper origin,
// so localStorage drafts persist) and exposes a mapleTax bridge for
// bundled files + server-side canada.ca fetching (no CORS in native code).
// C# 5 compatible (builds with the inbox .NET Framework csc.exe).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyVersion("1.0.0")]
[assembly: AssemblyTitle("MapleTax Canada")]
[assembly: AssemblyProduct("MapleTax Canada")]

namespace MapleTax
{
    internal static class NativeMethods
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern bool SetDllDirectory(string lpPathName);
    }

    // Called from JavaScript as window.mapleTax.fetchText / readBundled.
    public class Bridge
    {
        private static readonly HttpClient Http = new HttpClient();
        private const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 MapleTax/1.0";

        public async Task<string> FetchText(string url)
        {
            Uri u;
            try
            {
                u = new Uri(Convert.ToString(url));
            }
            catch
            {
                throw new ArgumentException("bad URL");
            }
            if (u.Scheme != Uri.UriSchemeHttps || u.Host != "www.canada.ca")
            {
                throw new ArgumentException("URL not allowed: " + u.Host);
            }
            using (HttpRequestMessage req = new HttpRequestMessage(HttpMethod.Get, u))
            {
                req.Headers.TryAddWithoutValidation("User-Agent", UA);
                req.Headers.TryAddWithoutValidation("Accept", "text/html,*/*");
                using (System.Threading.CancellationTokenSource cts = new System.Threading.CancellationTokenSource(TimeSpan.FromSeconds(25)))
                {
                    using (HttpResponseMessage res = await Http.SendAsync(req, cts.Token).ConfigureAwait(false))
                    {
                        if (!res.IsSuccessStatusCode)
                        {
                            throw new InvalidOperationException("HTTP " + ((int)res.StatusCode) + " from canada.ca");
                        }
                        byte[] buf = await res.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                        if (buf.Length > 3000000)
                        {
                            throw new InvalidOperationException("response too large");
                        }
                        return Encoding.UTF8.GetString(buf);
                    }
                }
            }
        }

        public string ReadBundled(string rel)
        {
            string key = Convert.ToString(rel).Replace("\\", "/");
            while (key.StartsWith("/"))
            {
                key = key.Substring(1);
            }
            byte[] data = Embedded.GetFile(key);
            return Encoding.UTF8.GetString(data);
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            int i;
            for (i = 0; i < args.Length; i++)
            {
                if (args[i] == "--smoke-test")
                {
                    RunSmokeTest();
                    return;
                }
            }
            // NOTE: WebView2 types must only be touched from Ui.Run below,
            // so this method JITs without those assemblies loaded.
            AppDomain.CurrentDomain.AssemblyResolve += OnResolve;
            ExtractLoader();
            Ui.Run();
        }

        private static void RunSmokeTest()
        {
            StringBuilder sb = new StringBuilder();
            sb.AppendLine("files=" + Embedded.FileCount);
            sb.AppendLine("bytes=" + Embedded.TotalBytes);
            sb.AppendLine("loader64=" + Embedded.LoaderX64.Length);
            sb.AppendLine("loader86=" + Embedded.LoaderX86.Length);
            sb.AppendLine("wv2core=" + Embedded.Wv2Core.Length);
            string dir = Path.Combine(Path.GetTempPath(), "MapleTax");
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "smoke.txt"), sb.ToString());
        }

        private static Assembly OnResolve(object sender, ResolveEventArgs args)
        {
            AssemblyName an;
            try
            {
                an = new AssemblyName(args.Name);
            }
            catch
            {
                return null;
            }
            if (an.Name == "Microsoft.Web.WebView2.Core")
            {
                return Assembly.Load(Embedded.Wv2Core);
            }
            if (an.Name == "Microsoft.Web.WebView2.WinForms")
            {
                return Assembly.Load(Embedded.Wv2Forms);
            }
            return null;
        }

        private static void ExtractLoader()
        {
            byte[] loader = (IntPtr.Size == 8) ? Embedded.LoaderX64 : Embedded.LoaderX86;
            string dir = Path.Combine(Path.GetTempPath(), "MapleTax", "wv2");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, "WebView2Loader.dll");
            bool write = true;
            try
            {
                FileInfo fi = new FileInfo(path);
                if (fi.Exists && fi.Length == loader.Length)
                {
                    write = false;
                }
            }
            catch
            {
                write = true;
            }
            if (write)
            {
                File.WriteAllBytes(path, loader);
            }
            NativeMethods.SetDllDirectory(dir);
        }
    }

    // All WebView2-touching UI lives here so Program.Main can JIT cleanly
    // before the embedded assemblies are resolved.
    internal static class Ui
    {
        private const string Host = "https://mapletax.local/";

        internal static void Run()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Form form = new Form();
            form.Text = "MapleTax Canada";
            form.Width = 1320;
            form.Height = 900;
            form.MinimumSize = new Size(1024, 700);
            form.StartPosition = FormStartPosition.CenterScreen;
            WebView2 web = new WebView2();
            web.Dock = DockStyle.Fill;
            form.Controls.Add(web);
            InitAsync(web);
            Application.Run(form);
        }

        internal static async Task InitAsync(WebView2 web)
        {
            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MapleTax", "webview");
            Directory.CreateDirectory(dataDir);
            CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.AddHostObjectToScript("mapleTax", new Bridge());
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Embedded.Shim);
            web.CoreWebView2.AddWebResourceRequestedFilter("https://mapletax.local/*", CoreWebView2WebResourceContext.All);
            web.CoreWebView2.WebResourceRequested += OnResource;
            web.CoreWebView2.Navigate(Host + "index.html");
        }

        private static void OnResource(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            WebView2 web = (WebView2)sender;
            string path = "index.html";
            string uri = e.Request.Uri;
            if (uri.StartsWith(Host))
            {
                path = uri.Substring(Host.Length);
            }
            int q = path.IndexOf('?');
            if (q >= 0)
            {
                path = path.Substring(0, q);
            }
            if (path.Length == 0)
            {
                path = "index.html";
            }
            byte[] data = Embedded.GetFileOrNull(path);
            if (data == null)
            {
                e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                return;
            }
            MemoryStream ms = new MemoryStream(data, false);
            e.Response = web.CoreWebView2.Environment.CreateWebResourceResponse(ms, 200, "OK", "Content-Type: " + MimeFor(path));
        }

        private static string MimeFor(string path)
        {
            string ext = "";
            int d = path.LastIndexOf('.');
            if (d >= 0)
            {
                ext = path.Substring(d).ToLowerInvariant();
            }
            if (ext == ".html")
            {
                return "text/html";
            }
            if (ext == ".css")
            {
                return "text/css";
            }
            if (ext == ".js")
            {
                return "text/javascript";
            }
            if (ext == ".json")
            {
                return "application/json";
            }
            if (ext == ".png")
            {
                return "image/png";
            }
            if (ext == ".svg")
            {
                return "image/svg+xml";
            }
            if (ext == ".ico")
            {
                return "image/x-icon";
            }
            return "application/octet-stream";
        }
    }
}
