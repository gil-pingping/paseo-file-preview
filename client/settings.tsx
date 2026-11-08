import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { strings } from "../shared/i18n";
import { isAllowedNetwork, isPrivateIPv4, networkSettings } from "../shared/network";

const t = strings();

const splitNetworks = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function NetworkSettings({ theme, layout }: PluginSurfaceProps) {
  const { colors } = theme;
  const settings = useSettings(networkSettings);
  const [enabled, setEnabled] = useState(false);
  const [bindHost, setBindHost] = useState("");
  const [networks, setNetworks] = useState("");

  const ready = settings.status === "ready" ? settings : null;
  useEffect(() => {
    if (!ready) return;
    setEnabled(ready.values.enabled);
    setBindHost(ready.values.bindHost);
    setNetworks(ready.values.allowedNetworks.join(", "));
  }, [ready?.revision]);

  const host = bindHost.trim();
  const list = splitNetworks(networks);
  const hostError = host !== "" && !isPrivateIPv4(host) ? t.lanHostInvalid : null;
  const networkError = list.some((n) => !isAllowedNetwork(n)) ? t.lanNetworksInvalid : null;
  const missing = enabled && (host === "" || list.length === 0) ? t.lanMissing : null;
  const blocked = !!(hostError || networkError || missing);
  const savedOn = ready ? ready.values.enabled : false;

  const hint = { color: colors.foregroundMuted, fontSize: 12, marginTop: 4, lineHeight: 18 };
  const error = { color: colors.statusDanger, fontSize: 12, marginTop: 4 };
  const label = { color: colors.foreground, fontSize: 13, fontWeight: "600" as const, marginTop: 16 };
  const input = {
    color: colors.foreground,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
    opacity: enabled ? 1 : 0.6,
  };

  if (settings.status === "loading") return <Text style={hint}>{t.loading}</Text>;
  if (settings.status === "error" || settings.status === "invalid")
    return <Text style={error}>{settings.error}</Text>;

  return (
    <View style={{ flex: 1, padding: layout.compact ? 12 : 20, backgroundColor: colors.surface0, maxWidth: 640 }}>
      <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "600" }}>{t.lanTitle}</Text>
      <Text style={hint}>{t.lanIntro}</Text>

      <View
        accessibilityRole="alert"
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.statusWarning,
          backgroundColor: colors.surface1,
        }}
      >
        <Text style={{ color: colors.statusWarning, fontWeight: "600" }}>⚠ {t.lanWarningTitle}</Text>
        <Text style={{ color: colors.foreground, fontSize: 12, marginTop: 6, lineHeight: 18 }}>{t.lanWarning}</Text>
      </View>

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        accessibilityLabel={t.lanToggle}
        onPress={() => setEnabled(!enabled)}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16 }}
      >
        <View
          style={{
            width: 40,
            height: 22,
            borderRadius: 11,
            padding: 2,
            backgroundColor: enabled ? colors.accent : colors.surface2,
            alignItems: enabled ? "flex-end" : "flex-start",
          }}
        >
          <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.foreground }} />
        </View>
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{t.lanToggle}</Text>
      </Pressable>

      <Text style={label}>{t.lanHost}</Text>
      <TextInput
        value={bindHost}
        onChangeText={setBindHost}
        placeholder={t.lanHostPlaceholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={t.lanHost}
        autoCapitalize="none"
        editable={enabled}
        style={input}
      />
      <Text style={hostError ? error : hint}>{hostError ?? t.lanHostHint}</Text>

      <Text style={label}>{t.lanNetworks}</Text>
      <TextInput
        value={networks}
        onChangeText={setNetworks}
        placeholder={t.lanNetworksPlaceholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={t.lanNetworks}
        autoCapitalize="none"
        editable={enabled}
        style={input}
      />
      <Text style={networkError ? error : hint}>{networkError ?? t.lanNetworksHint}</Text>

      {missing ? <Text style={{ ...error, marginTop: 12 }}>{missing}</Text> : null}
      {settings.saveError ? <Text style={{ ...error, marginTop: 12 }}>{settings.saveError}</Text> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.save}
          disabled={settings.saving || blocked}
          onPress={() => settings.save({ enabled, bindHost: host, allowedNetworks: list }, settings.revision)}
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 6,
            backgroundColor: colors.accent,
            opacity: settings.saving || blocked ? 0.5 : 1,
          }}
        >
          <Text style={{ color: colors.accentForeground }}>{settings.saving ? "…" : t.save}</Text>
        </Pressable>
        <Text style={{ color: savedOn ? colors.statusWarning : colors.foregroundMuted, fontSize: 12 }}>
          {savedOn && ready ? t.lanStatusOn(ready.values.bindHost) : t.lanStatusOff}
        </Text>
      </View>
    </View>
  );
}
