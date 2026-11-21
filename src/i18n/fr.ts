/** French core strings. Keep the keys in sync with en.ts (tests check it). */
export const fr: Record<string, string> = {
  "card.name": "JBL Bar Card",
  "card.description":
    "Pilotez une JBL Bar 9.1 : source, volume, son, minuteurs, messages sur l'afficheur et état du système.",

  "tab.home": "Accueil",
  "tab.sound": "Son",
  "tab.timers": "Minuteurs",
  "tab.system": "Système",

  "header.power_on": "Allumer",
  "header.power_off": "Éteindre",
  "header.mode_smart": "Smart",
  "header.mode_standard": "Standard",
  "header.standby": "En veille",
  "header.unreachable": "Injoignable",
  "header.details": "Détails",

  "common.cancel": "Annuler",
  "common.confirm": "OK",
  "common.close": "Fermer",
  "common.dismiss": "Masquer",
  "common.none": "aucune",
  "common.unknown": "—",

  "banner.unavailable":
    "La télécommande web de la barre de son est injoignable. Vérifiez que la barre est alimentée et sur le réseau, et que la télécommande JBL Bar Toolkit y tourne.",

  "error.bar_unavailable": "La barre de son est injoignable : rien n'a été envoyé. Réessayez quand elle sera de nouveau en ligne.",
  "error.no_bar":
    "Aucune JBL Bar 9.1 trouvée. Ajoutez d'abord l'intégration JBL Bar 9.1 (jbl_bar_91), puis choisissez son lecteur multimédia dans l'éditeur de la carte.",
  "error.entity_not_found":
    "{entity} n'existe pas. Barres JBL trouvées : {bars}. Choisissez-en une comme entité dans l'éditeur de la carte.",
  "error.not_jbl":
    "{entity} n'est pas un lecteur multimédia de l'intégration JBL Bar 9.1 (jbl_bar_91). Barres JBL trouvées : {bars}. Choisissez-en une comme entité.",
  "error.connection_lost":
    "La connexion à Home Assistant a été perdue : la commande n'a peut-être pas atteint la barre de son. Réessayez.",

  "svc.refused": "La barre a refusé la commande : {error}",
  "svc.unreachable": "La télécommande web de la barre est injoignable : {error}",
  "svc.unavailable": "Ce réglage n'est pas disponible pour le moment.",
  "svc.not_reached": "La barre n'a pas confirmé le niveau demandé.",
  "svc.busy": "La barre exécute encore une autre commande ; réessayez quand elle est terminée.",
  "svc.bass_offset_range": "La correction des basses va de -3 à +3 dB par pas de 0,5 dB.",
  "svc.unsupported_model":
    "La télécommande du toolkit à cette adresse indique maintenant le modèle {model}. Seule la Bar 9.1 (bar91) est prise en charge.",
  "svc.display_one_length": "Choisissez un seul réglage parmi répétitions, durée et jusqu'à effacement.",
  "svc.display_when_on_unsupported": "Cette télécommande du toolkit ne sait pas attendre que la barre soit allumée : mettez-la à jour.",
  "svc.display_duration": "La durée va de 1 seconde à 24 heures.",
  "svc.display_unsupported":
    "La télécommande installée sur la barre n'affiche pas encore de messages. Mettez à jour JBL Bar Toolkit sur la barre.",
  "svc.timer_duration": "La durée va de 1 seconde à 12 heures.",
  "svc.timer_ring": "La durée de sonnerie va de 3 secondes à 5 minutes.",
  "svc.timer_not_found": "Aucun minuteur nommé {name} n'est en cours.",
  "svc.timer_which": "Donnez le nom ou l'identifiant du minuteur, ou choisissez tous.",
  "svc.timer_unsupported":
    "La télécommande installée sur la barre n'a pas encore de minuteurs. Mettez à jour JBL Bar Toolkit sur la barre.",
  "svc.timer_extend_duration": "Le temps ajouté va de 1 seconde à 1 heure.",
  "svc.timer_none_running": "Aucun minuteur n'est en cours.",
  "svc.timer_extend_unsupported":
    "La télécommande installée sur la barre ne sait pas encore ajouter du temps à un minuteur. Mettez à jour JBL Bar Toolkit sur la barre.",
  "svc.restart_unsupported":
    "La télécommande installée sur la barre ne sait pas encore la redémarrer. Mettez à jour JBL Bar Toolkit sur la barre.",
  "svc.not_a_recent": "{entity} n'est pas un minuteur ou un message récent.",

  "config.invalid": "Configuration non valide.",
  "config.entity":
    "entity doit être le lecteur multimédia de la JBL Bar 9.1 (par exemple media_player.jbl_bar_9_1), reçu « {value} ».",
  "config.tabs_list": "tabs doit être une liste parmi : {allowed}.",
  "config.unknown_tab": "Onglet inconnu {value} dans tabs. Valeurs possibles : {allowed}.",
  "config.unknown_default_tab": "default_tab inconnu « {value} ». Valeurs possibles : {allowed}.",

  "busy.generic": "La barre de son est occupée",
  "busy.running": "{action}…",
  "busy.from_remote": "(depuis la page web)",

  "action.power": "Mise en marche ou arrêt de la barre",
  "action.volume_up": "Augmentation du volume",
  "action.volume_down": "Baisse du volume",
  "action.mute": "Activation ou coupure du son",
  "action.input_tv": "Passage sur TV",
  "action.input_hdmi": "Passage sur HDMI",
  "action.input_bluetooth": "Passage sur Bluetooth",
  "action.media_play": "Lancement de la lecture",
  "action.media_pause": "Mise en pause",
  "action.media_stop": "Arrêt de la lecture",
  "action.media_next": "Piste suivante",
  "action.media_previous": "Piste précédente",
  "action.bass_next": "Réglage du niveau des basses",
  "action.center_next": "Réglage du canal central",
  "action.atmos_next": "Réglage de la hauteur Atmos",
  "action.rear_next": "Réglage des enceintes arrière",
  "action.night_toggle": "Changement du mode nuit",
  "action.smart": "Passage en mode Smart",
  "action.standard": "Passage en mode Standard",
  "action.eq_apply": "Application de l'égaliseur avant",
  "action.eq_reset": "Réinitialisation de l'égaliseur avant",
  "action.av_sync_set": "Réglage de la synchronisation audio",
  "action.bluetooth_pair": "Lancement de l'appairage Bluetooth",
  "action.sub_pair": "Appairage du caisson de basses",
  "action.calibrate": "Calibrage du son surround",
  "action.bar91.bass-offset.set": "Réglage de la correction des basses",
  "action.bar91.display-clock.set": "Mise à jour de l'horloge de l'afficheur",
  "action.bar91.timer.start": "Démarrage d'un minuteur",
  "action.bar91.timer.cancel": "Arrêt d'un minuteur",
  "action.bar91.timer.extend": "Ajout de temps à un minuteur",
  "action.bar91.display-message.show": "Affichage d'un message",
  "action.bar91.display-message.cancel": "Effacement d'un message",
  "action.bar91.system.reboot": "Redémarrage de la barre de son",
  "action.unknown": "Exécution de {action}",

  "editor.entity": "Barre de son (lecteur multimédia)",
  "editor.name": "Nom",
  "editor.name_helper": "Laissez vide pour utiliser le nom de l'appareil.",
  "editor.compact": "Compact (Accueil seulement, sans onglets)",
  "editor.tabs": "Onglets visibles",
  "editor.default_tab": "Onglet par défaut",
  "editor.advanced": "Avancé",
  "editor.recent": "Afficher les minuteurs et messages récents avec plusieurs barres",
  "editor.recent_helper":
    "Les boutons des minuteurs et messages récents ne sont liés à aucune barre : ils appartiennent à la première barre JBL chargée par Home Assistant. Activez cette option uniquement sur la carte de cette barre.",
  "editor.loading": "Chargement de l'éditeur…",
};
