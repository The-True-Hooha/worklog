# Global Worklog Command Setup

Add the `worklog` command to your shell profile to run it from anywhere.

---

## PowerShell (Windows, macOS, Linux)

**1. Find your profile location:**
```powershell
$PROFILE
```

**2. Edit your profile:**
```powershell
notepad $PROFILE
```

**3. Add this function (update the path):**
```powershell
function Start-Worklog {
    <#
    .SYNOPSIS
    Starts the Worklog time tracking app

    .DESCRIPTION
    Opens the Worklog app in your default browser

    .EXAMPLE
    Start-Worklog
    worklog
    #>

    # UPDATE THIS PATH to your worklog location
    $worklogPath = "C:\Batsy\CodeGen\worklog\index.html"

    if (Test-Path $worklogPath) {
        Start-Process $worklogPath
        Write-Host "✓ Worklog opened!" -ForegroundColor Green
    } else {
        Write-Host "✗ Worklog not found at: $worklogPath" -ForegroundColor Red
        Write-Host "  Update the path in your profile function" -ForegroundColor Yellow
    }
}

# Alias for shorter command
Set-Alias -Name worklog -Value Start-Worklog
```

**4. Reload profile:**
```powershell
. $PROFILE
```

**5. Use it:**
```powershell
worklog
```

---

## Bash (Linux, macOS, WSL)

**1. Edit your bash profile:**
```bash
nano ~/.bashrc
```
or if using macOS:
```bash
nano ~/.bash_profile
```

**2. Add this function (update the path):**
```bash
# Worklog - Global launcher
worklog() {
    # UPDATE THIS PATH to your worklog location
    local worklog_path="$HOME/path/to/worklog/index.html"

    if [ -f "$worklog_path" ]; then
        echo "✓ Worklog opened!"

        # Detect OS and open accordingly
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            open "$worklog_path"
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            xdg-open "$worklog_path" 2>/dev/null || \
            sensible-browser "$worklog_path" 2>/dev/null || \
            x-www-browser "$worklog_path"
        else
            echo "✗ Unsupported OS: $OSTYPE"
            return 1
        fi
    else
        echo "✗ Worklog not found at: $worklog_path"
        echo "  Update the path in your profile function"
        return 1
    fi
}
```

**3. Reload profile:**
```bash
source ~/.bashrc
```

**4. Use it:**
```bash
worklog
```

---

## Zsh (macOS default, Linux)

**1. Edit your zsh profile:**
```bash
nano ~/.zshrc
```

**2. Add this function (update the path):**
```zsh
# Worklog - Global launcher
worklog() {
    # UPDATE THIS PATH to your worklog location
    local worklog_path="$HOME/path/to/worklog/index.html"

    if [[ -f "$worklog_path" ]]; then
        echo "✓ Worklog opened!"

        # Detect OS and open accordingly
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            open "$worklog_path"
        elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            xdg-open "$worklog_path" 2>/dev/null || \
            sensible-browser "$worklog_path" 2>/dev/null || \
            x-www-browser "$worklog_path"
        else
            echo "✗ Unsupported OS: $OSTYPE"
            return 1
        fi
    else
        echo "✗ Worklog not found at: $worklog_path"
        echo "  Update the path in your profile function"
        return 1
    fi
}
```

**3. Reload profile:**
```zsh
source ~/.zshrc
```

**4. Use it:**
```zsh
worklog
```

---

## Fish (Alternative shell)

**1. Create function file:**
```bash
nano ~/.config/fish/functions/worklog.fish
```

**2. Add this function (update the path):**
```fish
function worklog --description 'Start Worklog time tracking app'
    # UPDATE THIS PATH to your worklog location
    set worklog_path "$HOME/path/to/worklog/index.html"

    if test -f $worklog_path
        echo "✓ Worklog opened!"

        # Detect OS and open accordingly
        switch (uname)
            case Darwin
                # macOS
                open $worklog_path
            case Linux
                # Linux
                xdg-open $worklog_path 2>/dev/null; or \
                sensible-browser $worklog_path 2>/dev/null; or \
                x-www-browser $worklog_path
            case '*'
                echo "✗ Unsupported OS"
                return 1
        end
    else
        echo "✗ Worklog not found at: $worklog_path"
        echo "  Update the path in the function file"
        return 1
    end
end
```

**3. Reload functions:**
```fish
source ~/.config/fish/functions/worklog.fish
```

**4. Use it:**
```fish
worklog
```

---

## Quick Reference

| Shell | Profile File | Reload Command |
|-------|--------------|----------------|
| PowerShell | `$PROFILE` | `. $PROFILE` |
| Bash (Linux) | `~/.bashrc` | `source ~/.bashrc` |
| Bash (macOS) | `~/.bash_profile` | `source ~/.bash_profile` |
| Zsh | `~/.zshrc` | `source ~/.zshrc` |
| Fish | `~/.config/fish/functions/worklog.fish` | `source ~/.config/fish/functions/worklog.fish` |

---

## Tips

1. **Update the path** in the function to match your worklog location
2. After adding the function, **reload your profile** or restart your terminal
3. Run `worklog` from any directory to open the app
4. Works on Windows, macOS, Linux, and WSL
