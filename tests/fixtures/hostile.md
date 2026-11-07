# Hostile fixture

Opening this file must run no code, launch no program and contact no host. Every address here is
reserved for examples (`.invalid`, `example.com`) or a harmless placeholder.

## Script and event attributes

<script>document.title = 'script ran'</script>

<img src="x" onerror="document.title = 'onerror ran'">

<a href="#" onclick="document.title = 'onclick ran'">click me</a>

<svg onload="document.title = 'svg onload ran'"></svg>

<iframe src="https://example.invalid/frame"></iframe>

<object data="https://example.invalid/object"></object>

<form action="https://example.invalid/post"><input name="x"></form>

<meta http-equiv="refresh" content="0;url=https://example.invalid/redirect">

<style>@import url("https://example.invalid/style.css");</style>

<link rel="stylesheet" href="https://example.invalid/link.css">

## Protocol handlers

[ms-msdt](ms-msdt:/id/TestOnly)

[search-ms](search-ms:query=hostile&crumb=location:\\host.invalid\share)

[javascript](javascript:alert(1))

[vbscript](vbscript:msgbox(1))

[data](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)

[file URL to a program](file:///C:/Windows/System32/calc.exe)

## Executable targets

[shortcut](installer.lnk)

[html application](payload.hta)

[batch file](run.bat)

[relative path out of the folder](..\..\Windows\System32\calc.exe)

## UNC and remote image paths

![unc backslashes](\\host.invalid\share\a.png)

![unc forward slashes](//host.invalid/share/a.png)

![file url with host](file://host.invalid/share/a.png)

![file url with four slashes](file:////host.invalid/share/a.png)

![unc in angle brackets](<\\host.invalid\share\with space.png>)

<img src="\\host.invalid\share\b.png">

![remote https image](https://example.invalid/pixel.png)

![remote http image](http://example.invalid/pixel.png)
